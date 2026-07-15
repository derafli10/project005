import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Property-based tests for the Task Service.
 *
 * @tags Feature: project005-task-management-dss, Property 9, Property 10, Property 11
 *
 * Reference: design.md > Correctness Properties 9–11, Requirements 4.1, 4.2, 5.1.
 */

// ─── Mock: vi.hoisted ensures the stubs exist before the hoisted vi.mock ────

const { mockDb } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      task: {
        findUnique: fn(),
        findUniqueOrThrow: fn(),
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
      taskOverride: { create: fn() },
      taskEditLog: { createMany: fn(), findMany: fn() },
      taskEditLogRead: { createMany: fn(), findMany: fn() },
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
import { TaskService } from "@/lib/services/task.service";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import type { CreateTaskInput } from "@/lib/services/task.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Title: 1–255 non-empty chars (printable ASCII). */
const titleArb = fc
  .string({ minLength: 1, maxLength: 255 })
  .filter((s) => s.trim().length >= 1);

/** taskWeight: integer 0–10000. */
const taskWeightArb = fc.integer({ min: 0, max: 10000 });

/** sksWeight: integer 1–5. */
const sksWeightArb = fc.integer({ min: 1, max: 5 });

/** Hours in the future for the deadline. We keep it ≥ 1 to guarantee "future". */
const futureHoursArb = fc.integer({ min: 1, max: 24 * 365 });

/** Build a CreateTaskInput from primitives + a fixed `now`. */
function buildInput(
  title: string,
  taskWeight: number,
  sksWeight: number,
  futureHours: number,
  now: Date
): CreateTaskInput {
  return {
    title,
    taskWeight,
    sksWeight,
    deadlineAt: new Date(now.getTime() + futureHours * 60 * 60 * 1000),
  };
}

/**
 * Reference "now" anchored to the real clock. `createTask` validates the
 * deadline against `Date.now()` internally, so our deadlines must be in the
 * future relative to the *actual* current time — a hardcoded 2026 date is not.
 */
function fixedNow(): Date {
  return new Date(Date.now() + 60_000); // 1 min ahead, stable for the test
}

/** Register a user directly in the in-memory store and return the id. */
function seedUser(idOverride?: string): string {
  const store = getInMemoryStore();
  const id = idOverride ?? `user_${++store.counters.user}`;
  const now = new Date();
  const user = {
    id,
    email: `${id}@test.example`,
    name: id,
    passwordHash: null,
    role: "MEMBER" as const,
    locale: "EN" as const,
    digestEnabled: false,
    digestTime: null,
    deliveryChannel: "EMAIL" as const,
    telegramChatId: null,
    createdAt: now,
    updatedAt: now,
  };
  store.users.set(id, user);
  store.usersByEmail.set(user.email, id);
  return id;
}

// ─── Property 9: Task Queue Sorting by Priority Score ──────────────────────

describe("Property 9: Task Queue Sorting by Priority Score", () => {
  it("returns tasks ordered by priorityScore DESC (highest first)", async () => {
    const prop = fc.asyncProperty(
      fc.array(
        fc.tuple(taskWeightArb, sksWeightArb, futureHoursArb),
        { minLength: 2, maxLength: 8 }
      ),
      async (tasksInput) => {
        const count = tasksInput.length;
        const now = fixedNow();
        const userId = seedUser();

        for (let i = 0; i < count; i++) {
          const [taskWeight, sksWeight, futureHours] = tasksInput[i]!;
          // Distinguishable deadlines so the tiebreaker doesn't mask the sort.
          await TaskService.createTask(
            userId,
            buildInput(
              `Task ${i}`,
              taskWeight,
              sksWeight,
              futureHours,
              now
            )
          );
        }

        const queue = await TaskService.getUserTasks(userId, undefined, now);

        // No manual positions → sort key 1 (position) is uniform (null) for all,
        // so priorityScore DESC must drive ordering.
        for (let i = 1; i < queue.length; i++) {
          expect(queue[i - 1]!.priorityScore).toBeGreaterThanOrEqual(
            queue[i]!.priorityScore
          );
        }
      }
    );
    await fc.assert(prop, { numRuns: 25, maxSkipsPerRun: 50 });
  });
});

// ─── Property 10: Tiebreaker by Deadline ASC ───────────────────────────────

describe("Property 10: Task Queue Tiebreaker by Deadline", () => {
  it("sub-sorts equal-priorityScore tasks by deadlineAt ASC", async () => {
    const prop = fc.asyncProperty(
      fc.array(futureHoursArb, { minLength: 2, maxLength: 6 }),
      async (futureHours) => {
        const count = futureHours.length;
        const now = fixedNow();
        const userId = seedUser();

        // Identical weights → identical priorityScore component; deadlines vary.
        const fixedTaskWeight = 5000;
        const fixedSks = 3;
        for (let i = 0; i < count; i++) {
          await TaskService.createTask(
            userId,
            buildInput(`Tie ${i}`, fixedTaskWeight, fixedSks, futureHours[i]!, now)
          );
        }

        const queue = await TaskService.getUserTasks(userId, undefined, now);

        // All rows have the same score → deadline ASC is the active sort.
        const scores = queue.map((q) => q.priorityScore);
        const allSame = scores.length > 0 && scores.every((s) => s === scores[0]);
        if (allSame) {
          for (let i = 1; i < queue.length; i++) {
            expect(
              queue[i - 1]!.task.deadlineAt.getTime()
            ).toBeLessThanOrEqual(queue[i]!.task.deadlineAt.getTime());
          }
        } else {
          // If scores differ (deadlines far apart can shift the time component
          // across tiers), still verify global non-increasing score order, and
          // within each score-group verify deadline ASC.
          let groupStart = 0;
          for (let i = 1; i <= queue.length; i++) {
            const sameScore =
              i < queue.length &&
              queue[i]!.priorityScore === queue[groupStart]!.priorityScore;
            if (!sameScore) {
              for (let j = groupStart + 1; j < i; j++) {
                expect(
                  queue[j - 1]!.task.deadlineAt.getTime()
                ).toBeLessThanOrEqual(queue[j]!.task.deadlineAt.getTime());
              }
              groupStart = i;
            }
          }
        }
      }
    );
    await fc.assert(prop, { numRuns: 25 });
  });
});

// ─── Property 11: Manual Position Override Updates Task Record ─────────────

describe("Property 11: Manual Position Override Updates Task Record", () => {
  it("persists the new position on the UserTaskProgress bridge row", async () => {
    const reasonArb = fc
      .string({ minLength: 3, maxLength: 500 })
      .filter((s) => s.trim().length >= 3);
    const newPosArb = fc.integer({ min: 0, max: 50 });

    const prop = fc.asyncProperty(
      newPosArb,
      reasonArb,
      async (newPosition, reason) => {
        const now = fixedNow();
        const userId = seedUser();
        const created = await TaskService.createTask(
          userId,
          buildInput("Override target", 4000, 3, 48, now)
        );

        // Initial position is null (no override yet).
        let store = getInMemoryStore();
        let progress = store.userTaskProgress.get(`${userId}/${created.id}`);
        expect(progress).toBeDefined();
        expect(progress?.position).toBeNull();

        // Record an override from a (different) old position.
        const oldPosition = newPosition + 1;
        await TaskService.recordOverride(
          created.id,
          userId,
          oldPosition,
          newPosition,
          reason
        );

        // The bridge row's position must reflect the new value.
        store = getInMemoryStore();
        progress = store.userTaskProgress.get(`${userId}/${created.id}`);
        expect(progress).toBeDefined();
        expect(progress?.position).toBe(newPosition);

        // A TaskOverride audit row must also have been written.
        const overrideRows = Array.from(store.taskOverrides.values()).filter(
          (o) => o.taskId === created.id && o.userId === userId
        );
        expect(overrideRows.length).toBe(1);
        expect(overrideRows[0]!.reason).toBe(reason.trim());
      }
    );
    await fc.assert(prop, { numRuns: 25 });
  });

  it("rejects an override with a too-short reason", async () => {
    const now = fixedNow();
    const userId = seedUser();
    const created = await TaskService.createTask(
      userId,
      buildInput("Reject reason", 4000, 3, 48, now)
    );

    await expect(
      TaskService.recordOverride(created.id, userId, 5, 1, "ab")
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an override when the user has no progress row for the task", async () => {
    const now = fixedNow();
    const userId = seedUser();
    const otherUserId = seedUser();
    // Task owned by otherUserId.
    const created = await TaskService.createTask(
      otherUserId,
      buildInput("Foreign task", 4000, 3, 48, now)
    );

    // userId has NO bridge row for this task.
    await expect(
      TaskService.recordOverride(created.id, userId, 5, 1, "valid reason")
    ).rejects.toThrow(NotFoundError);
  });

  it("no-ops (does not throw) when oldPosition === newPosition", async () => {
    const now = fixedNow();
    const userId = seedUser();
    const created = await TaskService.createTask(
      userId,
      buildInput("No-op override", 4000, 3, 48, now)
    );

    await expect(
      TaskService.recordOverride(created.id, userId, 3, 3, "same position")
    ).resolves.toBeUndefined();

    // No override row should be written for a no-op.
    const store = getInMemoryStore();
    const overrideRows = Array.from(store.taskOverrides.values()).filter(
      (o) => o.taskId === created.id
    );
    expect(overrideRows.length).toBe(0);
  });
});

// ─── createTask validation ─────────────────────────────────────────────────

describe("TaskService.createTask validation", () => {
  it("rejects an empty title", async () => {
    const now = fixedNow();
    const userId = seedUser();
    await expect(
      TaskService.createTask(userId, {
        title: "   ",
        taskWeight: 4000,
        sksWeight: 3,
        deadlineAt: new Date(now.getTime() + 48 * 3600_000),
      })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an out-of-range taskWeight", async () => {
    const now = fixedNow();
    const userId = seedUser();
    await expect(
      TaskService.createTask(userId, {
        title: "Bad weight",
        taskWeight: 10001,
        sksWeight: 3,
        deadlineAt: new Date(now.getTime() + 48 * 3600_000),
      })
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a past deadline", async () => {
    const userId = seedUser();
    await expect(
      TaskService.createTask(userId, {
        title: "Past deadline",
        taskWeight: 4000,
        sksWeight: 3,
        deadlineAt: new Date(Date.now() - 1000),
      })
    ).rejects.toThrow(ValidationError);
  });

  it("creates a bridge row for the creator with status PENDING", async () => {
    const now = fixedNow();
    const userId = seedUser();
    const created = await TaskService.createTask(
      userId,
      buildInput("Bridge check", 4000, 3, 48, now)
    );

    const store = getInMemoryStore();
    const progress = store.userTaskProgress.get(`${userId}/${created.id}`);
    expect(progress).toBeDefined();
    expect(progress?.status).toBe("PENDING");
    expect(progress?.position).toBeNull();
  });
});

// ─── updateTask authorization + edit log ──────────────────────────────────

describe("TaskService.updateTask", () => {
  it("rejects edits from a non-creator", async () => {
    const now = fixedNow();
    const creator = seedUser();
    const other = seedUser();
    const created = await TaskService.createTask(
      creator,
      buildInput("Auth check", 4000, 3, 48, now)
    );

    await expect(
      TaskService.updateTask(created.id, other, { title: "Hijacked" })
    ).rejects.toThrow(AuthorizationError);
  });

  it("writes TaskEditLog rows only for changed fields", async () => {
    const now = fixedNow();
    const creator = seedUser();
    const created = await TaskService.createTask(
      creator,
      buildInput("Edit log", 4000, 3, 48, now)
    );

    await TaskService.updateTask(created.id, creator, {
      title: "Renamed task",
      // taskWeight & sksWeight unchanged → must NOT produce edit rows.
    });

    const store = getInMemoryStore();
    const logs = Array.from(store.taskEditLogs.values()).filter(
      (l) => l.taskId === created.id
    );
    expect(logs.length).toBe(1);
    expect(logs[0]!.fieldName).toBe("title");
  });
});

// ─── completeTask + Academic Comeback ─────────────────────────────────────

describe("TaskService.completeTask", () => {
  it("marks the bridge row as COMPLETED and sets completedAt", async () => {
    const now = fixedNow();
    const userId = seedUser();
    const created = await TaskService.createTask(
      userId,
      buildInput("Finish me", 4000, 3, 48, now)
    );

    const result = await TaskService.completeTask(created.id, userId);
    expect(result.task.id).toBe(created.id);
    expect(result.triggerCelebration).toBe(false); // score is well under 8000

    const store = getInMemoryStore();
    const progress = store.userTaskProgress.get(`${userId}/${created.id}`);
    expect(progress?.status).toBe("COMPLETED");
    expect(progress?.completedAt).not.toBeNull();
  });

  it("is idempotent — completing twice returns triggerCelebration=false", async () => {
    const now = fixedNow();
    const userId = seedUser();
    const created = await TaskService.createTask(
      userId,
      buildInput("Finish twice", 4000, 3, 48, now)
    );

    await TaskService.completeTask(created.id, userId);
    const second = await TaskService.completeTask(created.id, userId);
    expect(second.triggerCelebration).toBe(false);
    expect(second.stressDrop).toBe(0);
  });

  it("throws NotFoundError for a missing bridge row", async () => {
    const userId = seedUser();
    await expect(
      TaskService.completeTask("no-such-task", userId)
    ).rejects.toThrow(NotFoundError);
  });

  it("fires the Academic Comeback when prior cumulative score was OVERCOOKED", async () => {
    // Build a queue whose cumulative score exceeds 8000 (OVERCOOKED threshold).
    // Max single-task score: sks=5 (5*2000*0.4=4000) + taskWeight=10000 (4000)
    //   + timeUrgency=10000 (2000) = 10000. Two such tasks → 20000 > 8000.
    const now = fixedNow();
    const userId = seedUser();

    // Task A: SLA-imminent (deadline < 24h) → timeUrgency 10000.
    const taskA = await TaskService.createTask(
      userId,
      buildInput("Overcooked A", 10000, 5, 1, now)
    );
    // Task B: also SLA-imminent.
    await TaskService.createTask(
      userId,
      buildInput("Overcooked B", 10000, 5, 1, now)
    );

    // Completing taskA drops the cumulative score; since we were OVERCOOKED
    // (cumulative > 8000), the celebration must fire.
    const result = await TaskService.completeTask(taskA.id, userId);
    expect(result.oldTier).toBe("OVERCOOKED");
    expect(result.triggerCelebration).toBe(true);
    expect(result.stressDrop).toBeGreaterThan(0);
  });
});

// ─── Position-aware sort (manual override beats priorityScore) ─────────────

describe("Hybrid sort: manual position takes precedence over priorityScore", () => {
  it("places a task with an explicit position above higher-score null-position tasks", async () => {
    const now = fixedNow();
    const userId = seedUser();

    // Low-weight task — but we'll pin it to position 0.
    const pinned = await TaskService.createTask(
      userId,
      buildInput("Low score, pinned", 100, 1, 200, now)
    );
    // High-weight task — no manual position.
    await TaskService.createTask(
      userId,
      buildInput("High score, auto", 10000, 5, 200, now)
    );

    await TaskService.recordOverride(pinned.id, userId, 5, 0, "pin to top");

    const queue = await TaskService.getUserTasks(userId, undefined, now);
    expect(queue[0]!.task.id).toBe(pinned.id);
  });
});

// ─── Property 18: Task Edit Propagation and Audit Logging ──────────────────

describe("Property 18: Task Edit Propagation and Audit Logging", () => {
  it("propagates edits to the single shared Task record and creates TaskEditLog records", async () => {
    const prop = fc.asyncProperty(
      fc.tuple(titleArb, taskWeightArb, futureHoursArb), // initial values
      fc.tuple(titleArb, taskWeightArb, futureHoursArb), // updated values
      async (initial, updatedVal) => {
        resetInMemoryDb();
        hydrateMock();

        const [initTitle, initWeight, initHours] = initial;
        const [updTitle, updWeight, updHours] = updatedVal;

        const now = fixedNow();
        const creatorId = seedUser();
        const member1 = seedUser();
        const member2 = seedUser();

        // 1. Create a classroom and join members
        const classRoom = await client.classRoom.create({
          data: {
            className: "Physics 101",
            classCode: "PHY101AB",
            sksWeight: 3,
            creatorId,
          },
        });

        await client.classRoomMember.create({
          data: { classRoomId: classRoom.id, userId: creatorId },
        });
        await client.classRoomMember.create({
          data: { classRoomId: classRoom.id, userId: member1 },
        });
        await client.classRoomMember.create({
          data: { classRoomId: classRoom.id, userId: member2 },
        });

        // 2. Creator creates a task in the classroom
        const deadlineAt = new Date(now.getTime() + initHours * 60 * 60 * 1000);
        const task = await TaskService.createTask(creatorId, {
          title: initTitle,
          taskWeight: initWeight,
          deadlineAt,
          classRoomId: classRoom.id,
        });

        // 3. Creator propagates task updates
        const updatedDeadline = new Date(now.getTime() + updHours * 60 * 60 * 1000);
        const resultCount = await TaskService.propagateTaskUpdates(
          task.id,
          {
            title: updTitle,
            taskWeight: updWeight,
            deadlineAt: updatedDeadline,
          },
          creatorId
        );

        // Assert return value is 1 (as it is a single shared Task record)
        expect(resultCount).toBe(1);

        // 4. Assert single Task record exists in the store (no duplicates created)
        const store = getInMemoryStore();
        expect(store.tasks.size).toBe(1);

        const updatedTask = store.tasks.get(task.id);
        expect(updatedTask).toBeDefined();
        expect(updatedTask?.title).toBe(updTitle.trim());
        expect(updatedTask?.taskWeight).toBe(updWeight);
        expect(updatedTask?.deadlineAt.getTime()).toBe(updatedDeadline.getTime());

        // 5. Assert TaskEditLog records are created for modified fields
        const editLogs = Array.from(store.taskEditLogs.values()).filter(
          (l) => l.taskId === task.id
        );

        // We check which fields actually changed to determine expected log count
        const titleChanged = initTitle.trim() !== updTitle.trim();
        const weightChanged = initWeight !== updWeight;
        const deadlineChanged = deadlineAt.toISOString() !== updatedDeadline.toISOString();

        let expectedLogsCount = 0;
        if (titleChanged) expectedLogsCount++;
        if (weightChanged) expectedLogsCount++;
        if (deadlineChanged) expectedLogsCount++;

        expect(editLogs.length).toBe(expectedLogsCount);

        if (titleChanged) {
          const log = editLogs.find((l) => l.fieldName === "title");
          expect(log).toBeDefined();
          expect(log?.oldValue).toBe(initTitle.trim());
          expect(log?.newValue).toBe(updTitle.trim());
          expect(log?.editorId).toBe(creatorId);
        }

        if (weightChanged) {
          const log = editLogs.find((l) => l.fieldName === "taskWeight");
          expect(log).toBeDefined();
          expect(log?.oldValue).toBe(String(initWeight));
          expect(log?.newValue).toBe(String(updWeight));
          expect(log?.editorId).toBe(creatorId);
        }

        if (deadlineChanged) {
          const log = editLogs.find((l) => l.fieldName === "deadlineAt");
          expect(log).toBeDefined();
          expect(log?.oldValue).toBe(deadlineAt.toISOString());
          expect(log?.newValue).toBe(updatedDeadline.toISOString());
          expect(log?.editorId).toBe(creatorId);
        }
      }
    );

    await fc.assert(prop, { numRuns: 25 });
  });

  it("rejects task updates from a non-creator", async () => {
    resetInMemoryDb();
    hydrateMock();

    const creatorId = seedUser();
    const otherId = seedUser();
    const now = fixedNow();

    const task = await TaskService.createTask(creatorId, {
      title: "Shared Task",
      taskWeight: 5000,
      deadlineAt: new Date(now.getTime() + 48 * 3600_000),
    });

    await expect(
      TaskService.propagateTaskUpdates(
        task.id,
        { title: "Unauthorized Edit" },
        otherId
      )
    ).rejects.toThrow(AuthorizationError);
  });
});
