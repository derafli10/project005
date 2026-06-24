import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Property-based tests for the Recovery Mode Service.
 *
 * @tags Feature: project005-task-management-dss, Property 13, Property 14
 *
 * Reference: design.md > Correctness Properties 13–14, Requirements 7.1, 7.6.
 *
 *   Property 13 — Recovery Mode is offered iff cumulativeScore > 8000 (the
 *                 user-gated activation threshold, Requirement 7.1).
 *   Property 14 — Breaking down a high-weight Parent Task creates 3–5
 *                 SubTasks whose deadlines are spaced 1–2 days apart and whose
 *                 weights sum back to the Parent Task weight (Requirement 7.6).
 *
 * Additional coverage for the user-consent gating, candidate selection, and
 * parent auto-completion paths is included to lock the Recovery Mode contract.
 */

// ─── Mock harness: mirror of the shared in-memory client ----------------------
// vi.hoisted ensures the stubs exist before the hoisted vi.mock runs.

const { mockDb } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      task: {
        findUnique: fn(),
        findUniqueOrThrow: fn(),
        findMany: fn(),
        create: fn(),
        update: fn(),
      },
      userTaskProgress: {
        findUnique: fn(),
        findMany: fn(),
        create: fn(),
        createMany: fn(),
        update: fn(),
      },
      cookedScore: {
        findMany: fn(),
        upsert: fn(),
      },
      taskOverride: { create: fn() },
      taskEditLog: { createMany: fn() },
      classRoom: { findUnique: fn() },
      classRoomMember: { findUnique: fn(), findMany: fn() },
      $transaction: fn(),
    },
  };
});

let client: ReturnType<typeof buildInMemoryClient>;

/**
 * Recursively bind each `vi.fn()` stub in `mockDb` to the matching method on
 * the freshly-built in-memory client. The shared structure (top-level models
 * + nested method objects) is mirrored on both sides.
 */
function bind(stub: Record<string, unknown>, real: Record<string, unknown>) {
  for (const key of Object.keys(real)) {
    const realMember = real[key];
    const stubMember = stub[key];
    if (typeof realMember === "function") {
      if (stubMember) {
        (stubMember as Mock).mockImplementation(
          (realMember as (...a: unknown[]) => unknown).bind(real)
        );
      }
    } else if (realMember && typeof realMember === "object" && stubMember) {
      bind(
        stubMember as Record<string, unknown>,
        realMember as Record<string, unknown>
      );
    }
  }
}

function hydrateMock() {
  client = buildInMemoryClient();
  vi.clearAllMocks();
  bind(
    mockDb as unknown as Record<string, unknown>,
    client as unknown as Record<string, unknown>
  );
}

vi.mock("@/lib/db", () => ({
  db: mockDb,
  baseDb: mockDb,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

// Service imports MUST come after vi.mock declarations.
import { RecoveryModeService } from "@/lib/services/recovery-mode.service";
import { CookedMeterService } from "@/lib/services/cooked-meter.service";
import { ValidationError } from "@/lib/errors/domain-errors";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

// ─── Fixtures & arbitraries ─────────────────────────────────────────────────

const NOW = new Date("2026-06-23T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parent task weight eligible for breakdown (> 3000 bp, Requirement 7.5). */
const candidateWeightArb = fc.integer({ min: 3001, max: 10000 });

/** SKS credit weight, integer 1–5 (Requirement 3.2). */
const sksWeightArb = fc.integer({ min: 1, max: 5 });

/** Seed a Parent Task + its UserTaskProgress row in the in-memory store. */
async function seedParentTask(opts: {
  userId: string;
  taskWeight: number;
  sksWeight?: number;
  daysAhead?: number;
  status?: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  isSubTask?: boolean;
  parentTaskId?: string | null;
}) {
  const userId = opts.userId;
  const sksWeight = opts.sksWeight ?? 3;
  const daysAhead = opts.daysAhead ?? 10;
  const status = opts.status ?? "PENDING";
  const isSubTask = opts.isSubTask ?? false;

  const task = await client.task.create({
    data: {
      title: opts.parentTaskId ? "Child Part" : "High-weight Parent Task",
      description: "Recovery Mode candidate",
      sksWeight,
      taskWeight: opts.taskWeight,
      deadlineAt: new Date(NOW.getTime() + daysAhead * MS_PER_DAY),
      creatorId: userId,
      isSubTask,
      parentTaskId: opts.parentTaskId ?? null,
    },
  });

  await client.userTaskProgress.create({
    data: { userId, taskId: task.id, status },
  });

  return task;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Feature: project005-task-management-dss", () => {
  // ─── Property 13: Recovery Mode Activation Threshold ─────────────────────
  describe("Property 13: Recovery Mode Activation Threshold", () => {
    it("offers Recovery Mode if and only if cumulativeScore > 8000", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 15000 }), async (score) => {
          // Drive the threshold check by faking the computed cumulative score,
          // exercising the exact `> 8000` boundary used by the UI gate.
          vi.spyOn(CookedMeterService, "calculateCumulativeScore").mockResolvedValue(
            score
          );

          const offer = await CookedMeterService.shouldOfferRecoveryMode(
            "user_1",
            NOW
          );
          expect(offer).toBe(score > 8000);

          vi.restoreAllMocks();
        }),
        { numRuns: 200 }
      );
    });

    it("never auto-activates Recovery Mode — activation requires explicit user consent", async () => {
      // The design explicitly forbids unilateral activation (Requirement 7.1,
      // 14.3.1): `activateRecoveryMode` MUST receive a non-empty selection.
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 15000 }),
          async (score) => {
            vi.spyOn(CookedMeterService, "calculateCumulativeScore").mockResolvedValue(
              score
            );

            // A high score only surfaces the offer — it does not break anything down.
            const offer = await CookedMeterService.shouldOfferRecoveryMode(
              "user_1",
              NOW
            );
            const store = getInMemoryStore();
            const created = Array.from(store.tasks.values()).filter(
              (t) => t.isSubTask
            );

            // Offer correctness is independent of activation side-effects.
            expect(offer).toBe(score > 8000);
            // No sub-tasks should have been produced without explicit consent.
            expect(created).toHaveLength(0);

            vi.restoreAllMocks();
          }
        ),
        { numRuns: 50 }
      );
    });

    it("rejects activation when no taskIds are supplied (consent not given)", async () => {
      await expect(
        RecoveryModeService.activateRecoveryMode("user_1", [], NOW)
      ).rejects.toThrow(ValidationError);
    });

    it("activates only the tasks the user explicitly selected, ignoring the rest", async () => {
      const userId = "user_1";

      // Seed three high-weight parent candidates…
      const a = await seedParentTask({ userId, taskWeight: 8000 });
      const b = await seedParentTask({ userId, taskWeight: 5000 });
      const c = await seedParentTask({ userId, taskWeight: 4000 });

      // …but the user only consents to breaking down `a` and `c`.
      const result = await RecoveryModeService.activateRecoveryMode(
        userId,
        [a.id, c.id],
        NOW
      );

      expect(result.tasksBreakdown).toHaveLength(2);
      const brokenIds = result.tasksBreakdown.map((r) => r.parentTask.id).sort();
      expect(brokenIds).toEqual([a.id, c.id].sort());

      // `b` was never selected → no sub-tasks should reference it.
      const store = getInMemoryStore();
      const orphans = Array.from(store.tasks.values()).filter(
        (t) => t.parentTaskId === b.id
      );
      expect(orphans).toHaveLength(0);

      // Every breakdown payload must include a non-empty motivational text.
      expect(typeof result.motivationalText).toBe("string");
      expect(result.motivationalText.length).toBeGreaterThan(0);
    });
  });

  // ─── Property 14: Task Breakdown Creates Micro-Tasks ─────────────────────
  describe("Property 14: Task Breakdown Creates Micro-Tasks with Staggered Deadlines", () => {
    it("creates 3–5 subtasks whose weights sum to the parent and whose deadlines are spaced 1–2 days apart", async () => {
      await fc.assert(
        fc.asyncProperty(
          candidateWeightArb,
          sksWeightArb,
          fc.integer({ min: 3, max: 7 }), // daysAhead: guarantees a workable window
          async (parentWeight, sksWeight, daysAhead) => {
            const userId = "user_1";
            const parent = await seedParentTask({
              userId,
              taskWeight: parentWeight,
              sksWeight,
              daysAhead,
            });

            const subTasks = await RecoveryModeService.breakdownTask(
              parent.id,
              userId,
              NOW
            );

            // (a) Cardinality is constrained to the 3–5 range (Requirement 7.6).
            expect(subTasks.length).toBeGreaterThanOrEqual(3);
            expect(subTasks.length).toBeLessThanOrEqual(5);

            // (b) Every sub-task is flagged + linked back to the parent.
            // (c) Sum of sub-task weights must equal the parent weight.
            let weightSum = 0;
            const deadlines: number[] = [];
            for (const sub of subTasks) {
              expect(sub.isSubTask).toBe(true);
              expect(sub.parentTaskId).toBe(parent.id);
              expect(sub.taskWeight).toBeGreaterThan(0);
              weightSum += sub.taskWeight;
              deadlines.push(sub.deadlineAt.getTime());
            }
            expect(weightSum).toBe(parentWeight);

            // (d) Deadlines are strictly increasing and each gap is 1–2 days
            //     (Requirement 7.6: staggered 1–2 days apart).
            for (let i = 1; i < deadlines.length; i++) {
              const gapDays = (deadlines[i]! - deadlines[i - 1]!) / MS_PER_DAY;
              expect(gapDays).toBeGreaterThanOrEqual(1);
              expect(gapDays).toBeLessThanOrEqual(2);
            }

            resetInMemoryDb();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("persists a PENDING UserTaskProgress row for every created sub-task", async () => {
      const userId = "user_1";
      const parent = await seedParentTask({ userId, taskWeight: 6000 });

      const subTasks = await RecoveryModeService.breakdownTask(
        parent.id,
        userId,
        NOW
      );

      for (const sub of subTasks) {
        const progress = await client.userTaskProgress.findUnique({
          where: { userId_taskId: { userId, taskId: sub.id } },
        });
        expect(progress).not.toBeNull();
        expect(progress!.status).toBe("PENDING");
      }
    });

    it("auto-completes the parent once every sub-task is completed (Requirement 7.8)", async () => {
      const userId = "user_1";
      const parent = await seedParentTask({ userId, taskWeight: 5000 });

      const subTasks = await RecoveryModeService.breakdownTask(
        parent.id,
        userId,
        NOW
      );

      // Not yet complete → parent must remain incomplete.
      const beforeDone = await RecoveryModeService.checkParentCompletion(
        parent.id,
        userId
      );
      expect(beforeDone).toBe(false);

      // Mark every sub-task COMPLETED.
      for (const sub of subTasks) {
        await client.userTaskProgress.update({
          where: { userId_taskId: { userId, taskId: sub.id } },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }

      const nowDone = await RecoveryModeService.checkParentCompletion(
        parent.id,
        userId
      );
      expect(nowDone).toBe(true);

      // The parent's own progress row should now reflect COMPLETED.
      const parentProgress = await client.userTaskProgress.findUnique({
        where: { userId_taskId: { userId, taskId: parent.id } },
      });
      expect(parentProgress!.status).toBe("COMPLETED");
    });
  });

  // ─── Candidate selection (Requirement 7.5) ───────────────────────────────
  describe("Candidate task selection", () => {
    it("returns at most 3 parent tasks with taskWeight > 3000, sorted by priority score DESC", async () => {
      const userId = "user_1";

      // Three qualifying candidates with decreasing weights (and therefore
      // decreasing JIT priority, all else equal)…
      const heavy = await seedParentTask({ userId, taskWeight: 9000, sksWeight: 5, daysAhead: 2 });
      const mid = await seedParentTask({ userId, taskWeight: 6000, sksWeight: 3, daysAhead: 4 });
      const light = await seedParentTask({ userId, taskWeight: 4000, sksWeight: 2, daysAhead: 6 });
      // …plus distractors that must NOT be returned.
      const lowWeight = await seedParentTask({ userId, taskWeight: 2000, sksWeight: 3 }); // ≤ 3000
      const subTask = await seedParentTask({ userId, taskWeight: 9000, sksWeight: 5, isSubTask: true, parentTaskId: "task_x" });
      const done = await seedParentTask({ userId, taskWeight: 9000, sksWeight: 5, status: "COMPLETED" });

      const candidates = await RecoveryModeService.getCandidateTasksForRecovery(
        userId,
        NOW
      );

      expect(candidates).toHaveLength(3);
      // Priority-desc ordering: heaviest/soonest first.
      expect(candidates.map((t) => t.id)).toEqual([heavy.id, mid.id, light.id]);
      // Distractors excluded.
      const ids = candidates.map((t) => t.id);
      expect(ids).not.toContain(lowWeight.id);
      expect(ids).not.toContain(subTask.id);
      expect(ids).not.toContain(done.id);
    });

    it("returns an empty list when no qualifying candidates exist", async () => {
      const userId = "user_1";
      // Only sub-threshold + sub-task rows present.
      await seedParentTask({ userId, taskWeight: 2000 });
      await seedParentTask({ userId, taskWeight: 9000, isSubTask: true, parentTaskId: "task_x" });

      const candidates = await RecoveryModeService.getCandidateTasksForRecovery(
        userId,
        NOW
      );
      expect(candidates).toEqual([]);
    });
  });
});
