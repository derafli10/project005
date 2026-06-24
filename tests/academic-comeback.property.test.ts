import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Property-based tests for the Academic Comeback celebration system.
 *
 * @tags Feature: project005-task-management-dss, Property 22
 *
 * Reference: design.md > Correctness Property 22, Requirements 12.1, 12.5, 12.6.
 *
 *   Property 22 — Academic Comeback Celebration Trigger:
 *     WHEN a task with a computed Cooked Tier of OVERCOOKED is marked as
 *     COMPLETED, the system SHALL trigger the Academic Comeback celebration
 *     sequence including stress drop graph.
 *
 * Task 5.4 validates the `TaskService.completeTask` path that detects the
 * OVERCOOKED → lower-tier transition and populates the celebration context.
 */

// ─── Mock harness ───────────────────────────────────────────────────────────────

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
      academicWrapped: {
        findMany: fn(),
        upsert: fn(),
      },
      taskOverride: { create: fn() },
      taskEditLog: { createMany: fn() },
      classRoom: { findUnique: fn() },
      classRoomMember: { findUnique: fn(), findMany: fn() },
      user: { findUnique: fn() },
      $transaction: fn(),
    },
  };
});

let client: ReturnType<typeof buildInMemoryClient>;

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
import { TaskService } from "@/lib/services/task.service";
import { determineCookedTier } from "@/lib/services/task.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-24T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function seedUser(idOverride?: string): string {
  const store = getInMemoryStore();
  const id = idOverride ?? `user_${++store.counters.user}`;
  const now = new Date();
  store.users.set(id, {
    id,
    email: `${id}@test.example`,
    name: id,
    passwordHash: null,
    role: "MEMBER" as const,
    locale: "EN" as const,
    createdAt: now,
    updatedAt: now,
  });
  store.usersByEmail.set(`${id}@test.example`, id);
  return id;
}

/**
 * Seed a parent task + its UserTaskProgress row.
 * The task deadline is set well into the future so it won't cause SLA-breach
 * interference with tier calculations.
 */
async function seedTask(
  userId: string,
  overrides: {
    taskId?: string;
    taskWeight?: number;
    sksWeight?: number;
    isSubTask?: boolean;
    parentTaskId?: string | null;
    daysAhead?: number;
  } = {}
) {
  const store = getInMemoryStore();
  const taskId = overrides.taskId ?? `task_${++store.counters.task}`;
  const taskWeight = overrides.taskWeight ?? 5000;
  const sksWeight = overrides.sksWeight ?? 3;
  const isSubTask = overrides.isSubTask ?? false;
  const daysAhead = overrides.daysAhead ?? 10;

  store.tasks.set(taskId, {
    id: taskId,
    title: `Task ${taskId}`,
    description: null,
    sksWeight,
    taskWeight,
    deadlineAt: new Date(NOW.getTime() + daysAhead * MS_PER_DAY),
    isSubTask,
    parentTaskId: overrides.parentTaskId ?? null,
    classRoomId: null,
    creatorId: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  store.userTaskProgress.set(`${userId}/${taskId}`, {
    userId,
    taskId,
    status: "PENDING",
    position: null,
    completedAt: null,
    currentStressScore: 0,
  });

  return taskId;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Feature: project005-task-management-dss", () => {
  // ─── Property 22: Academic Comeback Celebration Trigger ──────────────────
  describe("Property 22: Academic Comeback Celebration Trigger", () => {
    it("triggers celebration when and only when completing a task while in OVERCOOKED tier", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 15000 }), // cumulative score BEFORE completion
          fc.integer({ min: 0, max: 15000 }), // cumulative score AFTER completion
          async (scoreBefore, scoreAfter) => {
            resetInMemoryDb();
            hydrateMock();

            const userId = seedUser();
            const taskId = await seedTask(userId, { taskWeight: 2000 });

            // Spy on the public static method (no `as any` needed — the method
            // is exported and typed). The first call returns the "before"
            // cumulative score; the second returns the "after" score.
            let callCount = 0;
            vi.spyOn(TaskService, "sumParentScores").mockImplementation(
              (_queue: unknown[]): number => {
                callCount++;
                return callCount === 1 ? scoreBefore : scoreAfter;
              }
            );

            // Stub getUserTasks to return an empty queue (avoids secondary
            // query complications — sumParentScores controls tier logic).
            vi.spyOn(TaskService, "getUserTasks").mockResolvedValue([]);

            const result = await TaskService.completeTask(taskId, userId);

            const wasOvercooked = scoreBefore > 8000;
            expect(result.triggerCelebration).toBe(wasOvercooked);

            if (wasOvercooked) {
              // Celebration context must be fully populated (Requirement 12.6).
              expect(result.celebrationContext).not.toBeNull();
              expect(result.celebrationContext!.oldTier).toBe("OVERCOOKED");
              expect(result.celebrationContext!.stressDrop).toBe(
                Math.max(0, scoreBefore - scoreAfter)
              );
              expect(result.celebrationContext!.completedTaskWeight).toBe(2000);
              expect(result.oldTier).toBe("OVERCOOKED");
              expect(result.stressDrop).toBe(Math.max(0, scoreBefore - scoreAfter));
            } else {
              // No celebration for non-OVERCOOKED completions.
              expect(result.celebrationContext).toBeNull();
            }

            vi.restoreAllMocks();
          }
        ),
        { numRuns: 100 }
      );
    });

    it("computes correct oldTier/newTier from the actual cumulative scores", async () => {
      const userId = seedUser();
      const taskId = await seedTask(userId, { taskWeight: 3000 });

      // Score 9000 = OVERCOOKED, after completing → 4000 = LET_HIM_COOK
      let callCount = 0;
      vi.spyOn(TaskService, "sumParentScores").mockImplementation(
        (_queue: unknown[]): number => {
          callCount++;
          return callCount === 1 ? 9000 : 4000;
        }
      );
      vi.spyOn(TaskService, "getUserTasks").mockResolvedValue([]);

      const result = await TaskService.completeTask(taskId, userId);

      expect(result.triggerCelebration).toBe(true);
      expect(result.oldTier).toBe("OVERCOOKED");
      expect(result.newTier).toBe("LET_HIM_COOK");
      expect(result.stressDrop).toBe(5000);
      expect(result.celebrationContext).not.toBeNull();
      expect(result.celebrationContext!.oldTier).toBe("OVERCOOKED");
      expect(result.celebrationContext!.newTier).toBe("LET_HIM_COOK");
      expect(result.celebrationContext!.stressDrop).toBe(5000);

      vi.restoreAllMocks();
    });

    it("does not trigger celebration when completing a task in SLIGHTLY_COOKED tier", async () => {
      const userId = seedUser();
      const taskId = await seedTask(userId, { taskWeight: 3000 });

      // Score 6000 = SLIGHTLY_COOKED, after completing → 2000 = MAIN_CHARACTER
      let callCount = 0;
      vi.spyOn(TaskService, "sumParentScores").mockImplementation(
        (_queue: unknown[]): number => {
          callCount++;
          return callCount === 1 ? 6000 : 2000;
        }
      );
      vi.spyOn(TaskService, "getUserTasks").mockResolvedValue([]);

      const result = await TaskService.completeTask(taskId, userId);

      expect(result.triggerCelebration).toBe(false);
      expect(result.oldTier).toBe("SLIGHTLY_COOKED");
      expect(result.newTier).toBe("MAIN_CHARACTER");
      expect(result.stressDrop).toBe(4000);
      expect(result.celebrationContext).toBeNull();

      vi.restoreAllMocks();
    });

    it("does not trigger celebration when already OVERCOOKED but re-completing the same task (idempotent)", async () => {
      const userId = seedUser();
      const taskId = await seedTask(userId, { taskWeight: 1000 });

      // Pre-set the progress to COMPLETED to exercise the idempotent branch.
      const store = getInMemoryStore();
      store.userTaskProgress.set(`${userId}/${taskId}`, {
        userId,
        taskId,
        status: "COMPLETED",
        position: null,
        completedAt: new Date(),
        currentStressScore: 0,
      });

      vi.spyOn(TaskService, "sumParentScores").mockReturnValue(8500); // OVERCOOKED
      vi.spyOn(TaskService, "getUserTasks").mockResolvedValue([]);

      const result = await TaskService.completeTask(taskId, userId);

      // Idempotent completion should never trigger celebration.
      expect(result.triggerCelebration).toBe(false);
      expect(result.celebrationContext).toBeNull();
      expect(result.stressDrop).toBe(0);

      vi.restoreAllMocks();
    });

    it("ensures stressDrop is always non-negative (never negative due to race conditions)", async () => {
      const userId = seedUser();
      const taskId = await seedTask(userId, { taskWeight: 1000 });

      // Edge case: "before" score lower than "after" (e.g. task had
      // past-deadline urgency spike before, completed after urgency decayed).
      // This shouldn't happen in practice but the code must be defensive.
      let callCount = 0;
      vi.spyOn(TaskService, "sumParentScores").mockImplementation(
        (_queue: unknown[]): number => {
          callCount++;
          return callCount === 1 ? 5000 : 9000; // after > before
        }
      );
      vi.spyOn(TaskService, "getUserTasks").mockResolvedValue([]);

      const result = await TaskService.completeTask(taskId, userId);

      // Should NOT be OVERCOOKED trigger (oldTier is SLIGHTLY_COOKED).
      expect(result.triggerCelebration).toBe(false);
      // stressDrop clamped to 0.
      expect(result.stressDrop).toBe(0);
      expect(result.stressDrop).toBeGreaterThanOrEqual(0);

      vi.restoreAllMocks();
    });

    it("determines tiers correctly via determineCookedTier for all boundary values", () => {
      // Boundary verification for the tier function used by completeTask.
      expect(determineCookedTier(0)).toBe("MAIN_CHARACTER");
      expect(determineCookedTier(2000)).toBe("MAIN_CHARACTER");
      expect(determineCookedTier(2001)).toBe("LET_HIM_COOK");
      expect(determineCookedTier(5000)).toBe("LET_HIM_COOK");
      expect(determineCookedTier(5001)).toBe("SLIGHTLY_COOKED");
      expect(determineCookedTier(8000)).toBe("SLIGHTLY_COOKED");
      expect(determineCookedTier(8001)).toBe("OVERCOOKED");
      expect(determineCookedTier(12000)).toBe("OVERCOOKED");
    });
  });
});
