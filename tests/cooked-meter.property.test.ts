import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

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

function bind(stub: Record<string, any>, real: Record<string, any>) {
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

import { CookedMeterService } from "@/lib/services/cooked-meter.service";
import { RecoveryModeService } from "@/lib/services/recovery-mode.service";
import type { Task, TaskStatus } from "@/generated/prisma";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

const NOW = new Date("2026-06-23T12:00:00Z");

describe("Feature: project005-task-management-dss", () => {
  // ─── Property 12: Cooked Tier Classification by Score Range ──────────────────
  describe("Property 12: Cooked Tier Classification by Score Range", () => {
    it("maps scores to correct CookedTier according to ranges, including boundary cases", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 15000 }), (score) => {
          const tier = CookedMeterService.determineTier(score);
          if (score <= 2000) {
            expect(tier).toBe("MAIN_CHARACTER");
          } else if (score <= 5000) {
            expect(tier).toBe("LET_HIM_COOK");
          } else if (score <= 8000) {
            expect(tier).toBe("SLIGHTLY_COOKED");
          } else {
            expect(tier).toBe("OVERCOOKED");
          }
        }),
        { numRuns: 500 }
      );

      // Explicit boundary testing (Requirement 6.3 - 6.6)
      expect(CookedMeterService.determineTier(0)).toBe("MAIN_CHARACTER");
      expect(CookedMeterService.determineTier(2000)).toBe("MAIN_CHARACTER");
      expect(CookedMeterService.determineTier(2001)).toBe("LET_HIM_COOK");
      expect(CookedMeterService.determineTier(5000)).toBe("LET_HIM_COOK");
      expect(CookedMeterService.determineTier(5001)).toBe("SLIGHTLY_COOKED");
      expect(CookedMeterService.determineTier(8000)).toBe("SLIGHTLY_COOKED");
      expect(CookedMeterService.determineTier(8001)).toBe("OVERCOOKED");
      expect(CookedMeterService.determineTier(12000)).toBe("OVERCOOKED");
    });
  });

  // ─── Property 13: Recovery Mode Activation Threshold ──────────────────────
  describe("Property 13: Recovery Mode Activation Threshold", () => {
    it("should offer recovery mode if and only if cumulativeScore > 8000", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 15000 }), async (score) => {
          // Setup in-memory state: we simulate a task that gives us the exact priority score we want.
          // In order to get an exact cumulative score, we mock `calculateCumulativeScore`.
          vi.spyOn(CookedMeterService, "calculateCumulativeScore").mockResolvedValue(score);

          const offer = await CookedMeterService.shouldOfferRecoveryMode("user_1", NOW);
          const expected = score > 8000;
          expect(offer).toBe(expected);

          vi.restoreAllMocks();
        }),
        { numRuns: 100 }
      );
    });
  });

  // ─── Property 14: Task Breakdown Creates Micro-Tasks with Staggered Deadlines ───
  describe("Property 14: Task Breakdown Creates Micro-Tasks with Staggered Deadlines", () => {
    it("creates 4 subtasks with proportional weights summing to parent task weight and deadlines spaced 1 day apart", async () => {
      // Generate a parent task weight in [3001, 10000]
      const taskWeightArb = fc.integer({ min: 3001, max: 10000 });

      await fc.assert(
        fc.asyncProperty(taskWeightArb, async (parentWeight) => {
          // Prepare DB state
          const store = getInMemoryStore();
          const userId = "user_1";
          
          // Seed the parent task in mock db
          const parentTask = await client.task.create({
            data: {
              title: "Parent Task",
              description: "High weight task",
              sksWeight: 3,
              taskWeight: parentWeight,
              deadlineAt: new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000), // 10 days out
              creatorId: userId,
              isSubTask: false,
            },
          });

          // Seed user task progress for parent
          await client.userTaskProgress.create({
            data: {
              userId,
              taskId: parentTask.id,
              status: "PENDING",
            },
          });

          // Trigger breakdown
          const subTasks = await RecoveryModeService.breakdownTask(parentTask.id, userId, NOW);

          // Verify 4 subtasks are created
          expect(subTasks.length).toBe(4);
          
          // Verify each subtask is marked isSubTask=true and parentTaskId set
          let weightSum = 0;
          for (let i = 0; i < subTasks.length; i++) {
            const sub = subTasks[i]!;
            expect(sub.isSubTask).toBe(true);
            expect(sub.parentTaskId).toBe(parentTask.id);
            
            // Check deadline spacing (1 day per index)
            const expectedTime = NOW.getTime() + (i + 1) * 24 * 60 * 60 * 1000;
            expect(sub.deadlineAt.getTime()).toBe(expectedTime);
            
            weightSum += sub.taskWeight;
          }

          // Verify sum of weights matches parent task weight
          expect(weightSum).toBe(parentWeight);

          // Clean up db store for next iteration
          resetInMemoryDb();
        }),
        { numRuns: 50 }
      );
    });
  });
});
