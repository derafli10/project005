import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Property-based tests for the Academic Wrapped Service.
 *
 * @tags Feature: project005-task-management-dss, Property 21
 *
 * Reference: design.md > Correctness Property 21, Requirement 11.2.
 *
 *   Property 21 — Weekly Saved Credits Calculation:
 *     For any user and any week date range, when calculating saved credits for
 *     Academic Wrapped, the system SHALL sum the taskWeight values of all tasks
 *     where status = COMPLETED AND completedAt falls within the week range
 *     [Monday 00:00, Sunday 23:59.999].
 *
 * NOTE: Property 22 (Academic Comeback Celebration Trigger) is a Task Service
 * concern and lives in `tests/academic-comeback.property.test.ts` (Task 5.4),
 * per the blueprint.
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

import { AcademicWrappedService } from "@/lib/services/academic-wrapped.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-22T12:00:00Z"); // Monday noon
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Feature: project005-task-management-dss", () => {
  // ─── Property 21: Weekly Saved Credits Calculation ──────────────────────────
  describe("Property 21: Weekly Saved Credits Calculation", () => {
    it("sums taskWeight for tasks completed within the week range and excludes others", async () => {
      // Anchoring week range: Monday 2026-06-22 00:00:00 UTC to Sunday 2026-06-28 23:59:59.999 UTC
      const weekStart = new Date(Date.UTC(2026, 5, 22, 0, 0, 0, 0));
      const weekEnd = new Date(Date.UTC(2026, 5, 28, 23, 59, 59, 999));

      const prop = fc.asyncProperty(
        fc.array(
          fc.record({
            taskWeight: fc.integer({ min: 100, max: 2000 }),
            // generate completedAt days offset relative to weekStart
            // offset from -5 to 12 days to cover inside and outside ranges
            dayOffset: fc.integer({ min: -5, max: 12 }),
            status: fc.constant("COMPLETED" as const),
          }),
          { minLength: 5, maxLength: 20 }
        ),
        async (testProgressData) => {
          resetInMemoryDb();
          hydrateMock();

          const userId = seedUser();
          const store = getInMemoryStore();

          let expectedSum = 0;
          let expectedCount = 0;

          for (const item of testProgressData) {
            // Create task
            const taskId = `task_${++store.counters.task}`;
            const deadline = new Date(weekStart.getTime() + 10 * MS_PER_DAY);
            store.tasks.set(taskId, {
              id: taskId,
              title: `Task ${taskId}`,
              description: null,
              sksWeight: 3,
              taskWeight: item.taskWeight,
              deadlineAt: deadline,
              isSubTask: false,
              parentTaskId: null,
              classRoomId: null,
              creatorId: userId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Compute completedAt Date
            const completedAt = new Date(weekStart.getTime() + item.dayOffset * MS_PER_DAY);

            store.userTaskProgress.set(`${userId}/${taskId}`, {
              userId,
              taskId,
              status: item.status,
              position: null,
              completedAt,
              currentStressScore: 0,
            });

            // Check if within Monday 00:00 UTC to Sunday 23:59:59.999 UTC
            if (completedAt >= weekStart && completedAt <= weekEnd) {
              expectedSum += item.taskWeight;
              expectedCount++;
            }
          }

          const stats = await AcademicWrappedService.calculateWeekStats(userId, weekStart);

          expect(stats.totalSavedCredits).toBe(expectedSum);
          expect(stats.tasksCompleted).toBe(expectedCount);
        }
      );

      await fc.assert(prop, { numRuns: 40 });
    });
  });
});
