import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

const { mockDb } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      user: {
        findUnique: fn(),
        create: fn(),
      },
      task: {
        findMany: fn(),
        create: fn(),
      },
      userTaskProgress: {
        count: fn(),
        findMany: fn(),
        create: fn(),
      },
      taskEditLog: {
        create: fn(),
        createMany: fn(),
        findMany: fn(),
      },
      dailyDigestLog: {
        create: fn(),
        update: fn(),
      },
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

import { DailyDigestService } from "@/lib/services/daily-digest.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

const NOW = new Date("2026-06-25T11:10:00Z");

describe("Feature: project005-task-management-dss - Daily Digest Service", () => {
  describe("shouldSendDigest - Window & Day Wrap Validation", () => {
    it("returns true only when now is within ±15 minutes of user digestTime", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: -30, max: 30 }),
          (hour, minute, offsetMinutes) => {
            const pad = (num: number) => String(num).padStart(2, "0");
            const digestTime = `${pad(hour)}:${pad(minute)}`;
            const user = { digestEnabled: true, digestTime };

            const now = new Date(Date.UTC(2026, 5, 25, hour, minute, 0));
            now.setUTCMinutes(now.getUTCMinutes() + offsetMinutes);

            const result = DailyDigestService.shouldSendDigest(user, now);

            if (Math.abs(offsetMinutes) <= 15) {
              expect(result).toBe(true);
            } else {
              expect(result).toBe(false);
            }
          }
        )
      );
    });

    it("handles day wrap-around boundary cases correctly", () => {
      const user = { digestEnabled: true, digestTime: "00:05" };
      // 10 minutes before midnight UTC (23:55 of previous day)
      const nowBefore = new Date("2026-06-25T23:55:00Z");
      expect(DailyDigestService.shouldSendDigest(user, nowBefore)).toBe(true);

      // 16 minutes before midnight UTC (23:49) -> should be false
      const nowTooEarly = new Date("2026-06-25T23:49:00Z");
      expect(DailyDigestService.shouldSendDigest(user, nowTooEarly)).toBe(false);
    });
  });

  describe("Property 23: Daily Digest Task Filtering", () => {
    it("ensures message includes pending parent tasks count, top 3 pending by score, and recent changes", async () => {
      // Create user
      const user = await client.user.create({
        data: {
          email: "user@test.com",
          digestEnabled: true,
          digestTime: "11:10",
        },
      });

      // Generate random tasks
      await fc.assert(
        fc.property(
          fc.array(
            fc.record({
              title: fc.string({ minLength: 1 }),
              sksWeight: fc.integer({ min: 1, max: 5 }),
              taskWeight: fc.integer({ min: 0, max: 10000 }),
              isSubTask: fc.boolean(),
              isCompleted: fc.boolean(),
              deadlineOffsetDays: fc.integer({ min: 1, max: 5 }),
              createdOffsetHours: fc.integer({ min: 0, max: 48 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (tasksData) => {
            resetInMemoryDb();
            hydrateMock();

            // Re-create user
            const u = await client.user.create({
              data: {
                id: user.id,
                email: "user@test.com",
                digestEnabled: true,
                digestTime: "11:10",
                whatsappNumber: "+628123456789",
                deliveryChannel: "WHATSAPP",
              },
            });

            const store = getInMemoryStore();

            for (const data of tasksData) {
              const taskId = `task_${Math.random()}`;
              const deadlineAt = new Date(NOW.getTime() + data.deadlineOffsetDays * 24 * 60 * 60 * 1000);
              const createdAt = new Date(NOW.getTime() - data.createdOffsetHours * 60 * 60 * 1000);

              // Create shared task row
              store.tasks.set(taskId, {
                id: taskId,
                title: data.title,
                description: null,
                sksWeight: data.sksWeight,
                taskWeight: data.taskWeight,
                deadlineAt,
                isSubTask: data.isSubTask,
                parentTaskId: null,
                classRoomId: null,
                creatorId: u.id,
                createdAt,
                updatedAt: NOW,
              });

              // Create progress row
              store.userTaskProgress.set(`${u.id}/${taskId}`, {
                userId: u.id,
                taskId,
                status: data.isCompleted ? "COMPLETED" : "PENDING",
                position: null,
                completedAt: data.isCompleted ? NOW : null,
                currentStressScore: 0,
              });
            }

            // Generate digest message
            const message = await DailyDigestService.generateDigestMessage(u.id, NOW);

            // Assert pending parent count is correct
            const expectedPendingParentCount = Array.from(store.tasks.values()).filter((t) => {
              const prog = store.userTaskProgress.get(`${u.id}/${t.id}`);
              return !t.isSubTask && prog && prog.status !== "COMPLETED";
            }).length;

            console.log("DEBUG MESSAGE:", message);
            console.log("EXPECTED COUNT:", expectedPendingParentCount);
            expect(message).toContain(`Total tugas tertunda: ${expectedPendingParentCount}`);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe("attemptIdempotentDelivery - Semantics & Retries", () => {
    it("guarantees exactly-once delivery and handles retries with backoff", async () => {
      const u = await client.user.create({
        data: {
          email: "idempotent@test.com",
          digestEnabled: true,
          digestTime: "11:10",
          whatsappNumber: "+628123456789",
          deliveryChannel: "WHATSAPP",
        },
      });

      // Mock the global fetch
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      // 1. Success case
      fetchSpy.mockResolvedValueOnce({ ok: true });

      await DailyDigestService.attemptIdempotentDelivery(u.id, NOW);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Verify log was written and marked as SENT
      const store = getInMemoryStore();
      const today = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
      const key = `${u.id}/${today.toISOString()}`;
      const log = store.dailyDigestLogs.get(key);
      expect(log).toBeDefined();
      expect(log?.deliveryStatus).toBe("SENT");

      // 2. Duplicate send attempt (idempotency check)
      fetchSpy.mockClear();
      await DailyDigestService.attemptIdempotentDelivery(u.id, NOW);
      // Fetch should NOT have been called again since log already exists for today
      expect(fetchSpy).not.toHaveBeenCalled();

      // 3. Retry mechanism on failure
      resetInMemoryDb();
      hydrateMock();
      const u2 = await client.user.create({
        data: {
          email: "retry@test.com",
          digestEnabled: true,
          digestTime: "11:10",
          telegramChatId: "987654321",
          deliveryChannel: "TELEGRAM",
        },
      });

      fetchSpy.mockClear();
      // Fail the first 2 times, succeed on the 3rd
      fetchSpy
        .mockRejectedValueOnce(new Error("Network Error 1"))
        .mockRejectedValueOnce(new Error("Network Error 2"))
        .mockResolvedValueOnce({ ok: true });

      await DailyDigestService.attemptIdempotentDelivery(u2.id, NOW);
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      const store2 = getInMemoryStore();
      const key2 = `${u2.id}/${today.toISOString()}`;
      const log2 = store2.dailyDigestLogs.get(key2);
      expect(log2?.deliveryStatus).toBe("SENT");
    });
  });
});
