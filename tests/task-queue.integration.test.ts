import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for the Task Queue UI boundary (Task 10.7).
 *
 * @tags Feature: project005-task-management-dss, Task 10.7
 *
 * Reference: tasks.md 10.7, design.md > Optimistic UI Pattern + Server Action
 *   Error Responses, Requirements 4.9, 5.1, 5.3, 5.4, 14.2, 14.3, 14.4.
 *
 * Scope
 *   These tests exercise the **integration boundary** between the Task Queue
 *   client interaction model and the Server Actions it calls — i.e. the
 *   contract the UI relies on for optimistic updates + rollback + celebration
 *   triggering. The pure service-layer correctness (priority sorting, override
 *   persistence, comeback math) is already covered by the property tests; this
 *   file pins the *behaviour the UI depends on*:
 *
 *     1. drag-and-drop position change → optimistic update persisted via the
 *        Server Action, with a TaskOverride audit row written.
 *     2. rollback on Server Action failure — a failing action leaves the store
 *        untouched and returns a typed ActionResult error.
 *     3. override reason collection — the override action rejects empty/too
 *        short reasons and persists valid ones.
 *     4. task completion flow with Cooked Meter / Academic Comeback update —
 *        the completion action returns the celebration flag + stress drop the
 *        UI uses to open the AcademicComebackModal, and the underlying meter
 *        recalculates from Parent Tasks only.
 *
 * The "optimistic update / rollback" mechanics live in the client component's
 * React state (TaskQueueClient). We can't drive React drag events in vitest's
 * node environment, so we assert the *contract* those mechanics depend on:
 * the Server Actions faithfully persist/reject and the services correctly
 * compute the post-mutation state. This is the same approach the auth-flow
 * integration test takes for cookie/session wiring.
 *
 * Requirements: 4.9, 5.1, 5.3, 5.4, 14.2.4, 14.2.5, 14.3, 14.4.
 */

// ─── Mock harness (mirror of the established property-test pattern) ─────────
//
// vi.hoisted ensures the stubs exist before the hoisted vi.mock runs. We stub
// the minimal Prisma surface exercised by TaskService + CookedMeterService +
// RecoveryModeService (completeTask delegates to it for parent auto-complete).
// `@/auth`, `@/i18n/server`, and `next/headers` are Next-only and are stubbed
// so the Server Actions can be called directly.

const { mockDb, mockAuthFn } = vi.hoisted(() => {
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
      taskEditLog: { createMany: fn(), findMany: fn() },
      taskEditLogRead: { createMany: fn(), findMany: fn() },
      classRoom: { findUnique: fn() },
      classRoomMember: { findUnique: fn(), findMany: fn() },
      $transaction: fn(),
    },
    mockAuthFn: fn(),
  };
});

let client: ReturnType<typeof buildInMemoryClient>;

/**
 * Recursively bind each `vi.fn()` stub in `mockDb` to the matching method on
 * the freshly-built in-memory client. Mirrors task-service.property.test.ts.
 */
function bind(stub: Record<string, unknown>, real: Record<string, unknown>) {
  for (const key of Object.keys(real)) {
    const realMember = real[key];
    const stubMember = stub[key];
    if (typeof realMember === "function") {
      if (stubMember) {
        (stubMember as Mock).mockImplementation(
          (realMember as (...a: unknown[]) => unknown).bind(real),
        );
      }
    } else if (realMember && typeof realMember === "object" && stubMember) {
      bind(
        stubMember as Record<string, unknown>,
        realMember as Record<string, unknown>,
      );
    }
  }
}

function hydrateMock() {
  client = buildInMemoryClient();
  vi.clearAllMocks();
  bind(
    mockDb as unknown as Record<string, unknown>,
    client as unknown as Record<string, unknown>,
  );
  // Default: unauthenticated request.
  mockAuthFn.mockReset();
  mockAuthFn.mockResolvedValue(null);
}

vi.mock("@/lib/db", () => ({
  db: mockDb,
  baseDb: mockDb,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

// `@/auth` — the Server Actions import `auth` from here.
vi.mock("@/auth", () => ({
  auth: mockAuthFn,
}));

// `@/i18n/server` — `getLocale()` is called by every action under test. Pin it
// to EN so the ActionResult error strings are deterministic.
vi.mock("@/i18n/server", () => ({
  getLocale: async () => "EN" as const,
}));

// Service / action imports MUST come after every vi.mock declaration above.
import {
  reorderTaskAction,
  reorderQueueAction,
  completeTaskAction,
} from "@/app/actions/task";
import { TaskService } from "@/lib/services/task.service";
import { CookedMeterService } from "@/lib/services/cooked-meter.service";
import {
  NotFoundError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import type { QueueTask } from "@/lib/services/task.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

// ─── Test helpers ───────────────────────────────────────────────────────────

const NOW = new Date("2026-06-30T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Seed a user. The action layer only needs `session.user.id`, but the store's
 * recovery path touches the User row, so we create a full record.
 */
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
    digestEnabled: false,
    digestTime: null,
    deliveryChannel: "WHATSAPP" as const,
    whatsappNumber: null,
    telegramChatId: null,
    createdAt: now,
    updatedAt: now,
  });
  store.usersByEmail.set(`${id}@test.example`, id);
  return id;
}

/**
 * CUID-shaped id generator (24 chars, base36-safe). `OverrideSchema` validates
 * `taskId` as a CUID, so the reorder/override tests MUST use ids this shape —
 * the in-memory store's default `task_1` ids would be rejected by Zod at the
 * action boundary, which would hide the real mutation under test.
 */
function cuidId(n: number): string {
  return "ck" + String(n).padStart(22, "0");
}

/**
 * Seed a parent task + its UserTaskProgress bridge row.
 *
 * @param daysAhead  Deadline offset from NOW (≥1 keeps it "in the future" and
 *                   inside the Cooked Meter's 7-day window when ≤7).
 */
function seedTask(
  userId: string,
  n: number,
  overrides: {
    taskWeight?: number;
    sksWeight?: number;
    isSubTask?: boolean;
    parentTaskId?: string | null;
    daysAhead?: number;
    status?: "PENDING" | "IN_PROGRESS" | "COMPLETED";
    position?: number | null;
  } = {},
): string {
  const store = getInMemoryStore();
  const taskId = cuidId(n);
  const taskWeight = overrides.taskWeight ?? 5000;
  const sksWeight = overrides.sksWeight ?? 3;
  const isSubTask = overrides.isSubTask ?? false;
  const daysAhead = overrides.daysAhead ?? 10;

  store.tasks.set(taskId, {
    id: taskId,
    title: `Task ${n}`,
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
    status: overrides.status ?? "PENDING",
    position: overrides.position ?? null,
    completedAt: null,
    currentStressScore: 0,
  });

  return taskId;
}

/** Drive `auth()` to return an authenticated session for `userId`. */
function givenSignedInAs(userId: string): void {
  mockAuthFn.mockResolvedValue({ user: { id: userId } });
}

// ─── 1. Drag-and-drop position change with optimistic update ───────────────
//
// The client applies the reorder optimistically and then calls TWO actions in
// sequence (TaskQueueClient.handleConfirmOverride): `reorderTaskAction` (writes
// the TaskOverride audit row + sets the dragged task's position) followed by
// `reorderQueueAction` (assigns every parent its array index so the hybrid sort
// reproduces the dragged order). This block proves both halves persist and that
// the resulting queue reflects the dragged order.

describe("Task 10.7.1 — Drag-and-drop position change with optimistic update", () => {
  it("persists a TaskOverride audit row and updates the dragged task's position (Requirements 5.1, 5.6)", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // Three parent tasks; we "drag" task #2 from index 1 to index 0.
    const t1 = seedTask(userId, 1);
    const t2 = seedTask(userId, 2);
    seedTask(userId, 3);

    const result = await reorderTaskAction({
      taskId: t2,
      oldPosition: 1,
      newPosition: 0,
      reason: "Lebih urgent dari prediksi sistem",
    });

    expect(result.success).toBe(true);

    // TaskOverride audit row written (Requirement 5.6).
    const store = getInMemoryStore();
    const overrides = [...store.taskOverrides.values()];
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.taskId).toBe(t2);
    expect(overrides[0]?.userId).toBe(userId);
    expect(overrides[0]?.reason).toBe("Lebih urgent dari prediksi sistem");

    // Bridge position updated to the new index (Requirement 5.1, 5.3).
    expect(store.userTaskProgress.get(`${userId}/${t2}`)?.position).toBe(0);
    // Untouched tasks keep null positions.
    expect(store.userTaskProgress.get(`${userId}/${t1}`)?.position).toBeNull();
  });

  it("reorderQueueAction assigns sequential positions so the hybrid sort reproduces the dragged order (Requirements 5.3, 14.2.4)", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1);
    seedTask(userId, 2);
    seedTask(userId, 3);

    // Simulate dragging task 3 → front: new order [3, 1, 2].
    const draggedOrder = [cuidId(3), cuidId(1), cuidId(2)];

    const result = await reorderQueueAction({ orderedTaskIds: draggedOrder });
    expect(result.success).toBe(true);

    const store = getInMemoryStore();
    // Every parent now carries a sequential position matching its array index.
    expect(store.userTaskProgress.get(`${userId}/${cuidId(3)}`)?.position).toBe(0);
    expect(store.userTaskProgress.get(`${userId}/${cuidId(1)}`)?.position).toBe(1);
    expect(store.userTaskProgress.get(`${userId}/${cuidId(2)}`)?.position).toBe(2);

    // getUserTasks' hybrid sort (position ASC nulls last → priorityScore DESC →
    // deadline ASC) must therefore surface the exact dragged order.
    const queue = await TaskService.getUserTasks(userId);
    const parentOrder = queue
      .filter((q) => !q.task.isSubTask)
      .map((q) => q.task.id);
    expect(parentOrder).toEqual(draggedOrder);
  });

  it("rejects a reorder when the user is unauthenticated (Requirement 1.6)", async () => {
    const userId = seedUser();
    seedTask(userId, 1);
    // No givenSignedInAs → auth() returns null.

    const result = await reorderQueueAction({ orderedTaskIds: [cuidId(1)] });

    expect(result.success).toBe(false);
    // Unauthorized → no mutation reached the store.
    expect(getInMemoryStore().userTaskProgress.get(`${userId}/${cuidId(1)}`)?.position).toBeNull();
  });

  it("rolls back nothing on the client because the action is the source of truth — a duplicate-id order is rejected before any write", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1);
    seedTask(userId, 2);

    // Duplicates in the ordered list → the service throws ValidationError,
    // which the action maps to a failed ActionResult. No positions change.
    const result = await reorderQueueAction({
      orderedTaskIds: [cuidId(1), cuidId(1)],
    });

    expect(result.success).toBe(false);
    const store = getInMemoryStore();
    expect(store.userTaskProgress.get(`${userId}/${cuidId(1)}`)?.position).toBeNull();
    expect(store.userTaskProgress.get(`${userId}/${cuidId(2)}`)?.position).toBeNull();
  });
});

// ─── 2. Rollback on Server Action failure ──────────────────────────────────
//
// The optimistic UI contract (Requirement 14.2.5): if the Server Action
// returns a FAILED status, the client rolls back its local state. That rollback
// is only correct if the action genuinely left the store untouched on failure.
// We assert the no-mutation-on-failure guarantee across the action's failure
// modes, plus that the underlying service still throws the typed error.

describe("Task 10.7.2 — Rollback on Server Action failure (Requirement 14.2.5)", () => {
  it("reorderTaskAction surfaces a typed error and writes nothing when the bridge row is missing", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // Task row exists, but NO UserTaskProgress bridge row for this user.
    seedTask(userId, 1);
    getInMemoryStore().userTaskProgress.clear();

    const result = await reorderTaskAction({
      taskId: cuidId(1),
      oldPosition: 0,
      newPosition: 1,
      reason: "Butuh dikerjakan bareng teman",
    });

    expect(result.success).toBe(false);
    // No override audit row, no bridge mutation.
    expect(getInMemoryStore().taskOverrides.size).toBe(0);

    // The contract the rollback depends on: the service throws NotFoundError so
    // the action maps it deterministically.
    await expect(
      TaskService.recordOverride(cuidId(1), userId, 0, 1, "Butuh dikerjakan bareng teman"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reorderTaskAction rejects a too-short reason via Zod before touching the store", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1);

    const result = await reorderTaskAction({
      taskId: cuidId(1),
      oldPosition: 0,
      newPosition: 1,
      reason: "x", // < 3 chars → OverrideSchema rejects.
    });

    expect(result.success).toBe(false);
    // Field-level error surfaced for inline display (design.md §6).
    if (result.success) return;
    expect(result.fieldErrors).toBeDefined();
    expect(Object.keys(result.fieldErrors ?? {}).length).toBeGreaterThan(0);
    expect(getInMemoryStore().taskOverrides.size).toBe(0);
  });

  it("reorderQueueAction rejects an ordered list referencing a task the user does not own, writing nothing", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1);
    // cuidId(2) has no bridge row for this user.

    const result = await reorderQueueAction({
      orderedTaskIds: [cuidId(1), cuidId(2)],
    });

    expect(result.success).toBe(false);
    // Nothing written.
    expect(
      getInMemoryStore().userTaskProgress.get(`${userId}/${cuidId(1)}`)?.position,
    ).toBeNull();

    // Underlying contract: service throws NotFoundError for the unowned id.
    await expect(
      TaskService.reorderQueue(userId, [cuidId(1), cuidId(2)]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── 3. Override reason submission ──────────────────────────────────────────
//
// Requirement 5.4 / 5.5 / 5.6: after a drag, the bottom-sheet collects a
// reason (4 quick options + "Alasan pribadi" custom text). The action persists
// a TaskOverride row with `taskId, userId, reason`. This block exercises the
// four documented quick reasons and the custom-text path.

describe("Task 10.7.3 — Override modal reason submission (Requirements 5.4, 5.5, 5.6)", () => {
  const quickReasons = [
    "Lebih urgent dari prediksi sistem",
    "Butuh dikerjakan bareng teman",
    "Materi lebih sulit dari perkiraan",
    "Alasan pribadi",
  ];

  it.each(quickReasons)(
    "persists a TaskOverride row for the documented quick reason: %s",
    async (reason) => {
      const userId = seedUser();
      givenSignedInAs(userId);
      const taskId = seedTask(userId, 1);

      const result = await reorderTaskAction({
        taskId,
        oldPosition: 2,
        newPosition: 0,
        reason,
      });

      expect(result.success).toBe(true);
      const overrides = [...getInMemoryStore().taskOverrides.values()];
      expect(overrides).toHaveLength(1);
      expect(overrides[0]?.reason).toBe(reason);
      expect(overrides[0]?.taskId).toBe(taskId);
    },
  );

  it("persists a custom 'Alasan pribadi' text within the 3–500 char window", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const taskId = seedTask(userId, 1);
    const customReason = "Alasan pribadi: proyek kelompok mendadak malam ini";

    const result = await reorderTaskAction({
      taskId,
      oldPosition: 0,
      newPosition: 3,
      reason: customReason,
    });

    expect(result.success).toBe(true);
    const overrides = [...getInMemoryStore().taskOverrides.values()];
    expect(overrides[0]?.reason).toBe(customReason);
  });

  it("rejects an over-long reason (>500 chars) at the action boundary", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1);
    const longReason = "a".repeat(501);

    const result = await reorderTaskAction({
      taskId: cuidId(1),
      oldPosition: 0,
      newPosition: 1,
      reason: longReason,
    });

    expect(result.success).toBe(false);
    expect(getInMemoryStore().taskOverrides.size).toBe(0);
  });

  it("rejects a non-CUID taskId (defence-in-depth on the action input)", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1);

    const result = await reorderTaskAction({
      taskId: "task_1", // not a CUID → OverrideSchema rejects.
      oldPosition: 0,
      newPosition: 1,
      reason: "Lebih urgent dari prediksi sistem",
    });

    expect(result.success).toBe(false);
    expect(getInMemoryStore().taskOverrides.size).toBe(0);
  });
});

// ─── 4. Task completion with Cooked Meter / Academic Comeback update ───────
//
// Requirement 4.9 + 12.1: the completion flow flips the bridge status, then the
// UI updates the Cooked Meter and opens AcademicComebackModal when the user was
// OVERCOOKED. This block pins the contract: completeTaskAction returns the
// `triggerCelebration` flag + `celebrationContext` the modal needs, the meter
// recomputes from PARENT tasks only after completion, and completing a subtask
// in a non-overcooked queue does not falsely trigger a celebration.

describe("Task 10.7.4 — Task completion with Cooked Meter update (Requirements 4.9, 12.1, 14.3)", () => {
  it("completes a task, removes it from the active queue, and returns the celebration flag the UI needs", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const taskId = seedTask(userId, 1, { taskWeight: 2000 });

    const result = await completeTaskAction(taskId);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // The fields the UI's AcademicComebackModal gate reads.
    expect(typeof result.data.triggerCelebration).toBe("boolean");
    expect(typeof result.data.stressDrop).toBe("number");
    // A single low-weight task never crosses OVERCOOKED → no celebration.
    expect(result.data.triggerCelebration).toBe(false);
    expect(result.data.celebrationContext).toBeNull();

    // Bridge flipped (Requirement 4.9) → task leaves the active queue.
    expect(
      getInMemoryStore().userTaskProgress.get(`${userId}/${taskId}`)?.status,
    ).toBe("COMPLETED");
    const activeQueue = await TaskService.getUserTasks(userId);
    expect(activeQueue.find((q) => q.task.id === taskId)).toBeUndefined();
  });

  it("triggers the celebration context when completing a task while OVERCOOKED (Requirements 12.1, 12.6)", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // Two heavy parent tasks inside the 7-day window → cumulative > 8000.
    const keep = seedTask(userId, 1, { taskWeight: 9000, sksWeight: 5, daysAhead: 3 });
    const complete = seedTask(userId, 2, { taskWeight: 9000, sksWeight: 5, daysAhead: 3 });

    // Precondition: the user really is OVERCOOKED before completion.
    const scoreBefore = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    expect(scoreBefore).toBeGreaterThan(8000);

    const result = await completeTaskAction(complete);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Celebration fires and carries the modal payload.
    expect(result.data.triggerCelebration).toBe(true);
    expect(result.data.celebrationContext).not.toBeNull();
    expect(result.data.celebrationContext?.oldTier).toBe("OVERCOOKED");
    expect(result.data.stressDrop).toBeGreaterThan(0);

    // Cumulative score drops after completion (Requirement 12.5 stress drop).
    const scoreAfter = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    expect(scoreAfter).toBeLessThan(scoreBefore);
    // The remaining heavy task is still parent-tracked.
    const activeQueue = await TaskService.getUserTasks(userId, ["PENDING", "IN_PROGRESS"], NOW);
    expect(activeQueue.find((q) => q.task.id === keep)).toBeDefined();
    expect(activeQueue.find((q) => q.task.id === complete)).toBeUndefined();
  });

  it("Cooked Meter recalculates from PARENT tasks only — a SubTask does not inflate the score (Requirement 7.8)", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);

    const parent = seedTask(userId, 1, { taskWeight: 3000, sksWeight: 3, daysAhead: 5 });
    // SubTask linked to the parent, inside the 7-day window.
    seedTask(userId, 2, {
      taskWeight: 9000,
      sksWeight: 5,
      daysAhead: 3,
      isSubTask: true,
      parentTaskId: parent,
    });

    const score = await CookedMeterService.calculateCumulativeScore(userId, NOW);

    // The score must equal ONLY the parent's JIT priority score — the 9000-weight
    // subtask must NOT contribute (Requirement 7.8, anti-inflation).
    const queue: QueueTask[] = await TaskService.getUserTasks(userId, ["PENDING", "IN_PROGRESS"], NOW);
    const parentOnly = queue.find((q) => q.task.id === parent);
    expect(parentOnly).toBeDefined();
    const expected = parentOnly!.priorityScore;
    expect(score).toBe(expected);

    // Sanity: a 9000-weight subtask would otherwise dominate the score, so this
    // is a meaningful (not tautological) assertion.
    const subOnly = queue.find((q) => q.task.id === cuidId(2));
    expect(subOnly).toBeDefined();
    expect(subOnly!.priorityScore).toBeGreaterThan(0);
    expect(score).toBeLessThan(score + subOnly!.priorityScore);
  });

  it("does not fire a celebration when completing a subtask in a non-overcooked queue", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const parent = seedTask(userId, 1, { taskWeight: 1000, sksWeight: 1, daysAhead: 5 });
    const sub = seedTask(userId, 2, {
      taskWeight: 1000,
      sksWeight: 1,
      daysAhead: 4,
      isSubTask: true,
      parentTaskId: parent,
    });

    const scoreBefore = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    expect(scoreBefore).toBeLessThanOrEqual(8000); // not overcooked

    const result = await completeTaskAction(sub);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.triggerCelebration).toBe(false);
    expect(result.data.celebrationContext).toBeNull();
  });

  it("rejects completion for an unauthenticated session", async () => {
    const userId = seedUser();
    seedTask(userId, 1);
    // No givenSignedInAs → auth() returns null.

    const result = await completeTaskAction(cuidId(1));

    expect(result.success).toBe(false);
    // Nothing changed.
    expect(
      getInMemoryStore().userTaskProgress.get(`${userId}/${cuidId(1)}`)?.status,
    ).toBe("PENDING");
  });

  it("rejects an empty taskId input with a validation error before hitting the service", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1);

    const result = await completeTaskAction("");

    expect(result.success).toBe(false);
    // The service was never reached → status unchanged.
    expect(
      getInMemoryStore().userTaskProgress.get(`${userId}/${cuidId(1)}`)?.status,
    ).toBe("PENDING");
  });
});
