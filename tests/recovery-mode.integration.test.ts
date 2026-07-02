import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for the Recovery Mode UI boundary (Task 11.6).
 *
 * @tags Feature: project005-task-management-dss, Task 11.6
 *
 * Reference: tasks.md 11.6, design.md > Recovery Mode Service + Cooked Meter
 *   Service + Server Action Error Responses, Requirements 7.1, 7.2, 7.3, 7.8,
 *   14.3.1, 14.3.2.
 *
 * Scope
 *   These tests exercise the **integration boundary** between the Recovery
 *   Mode modal (`RecoveryModeModal.tsx`) and the Server Actions it calls —
 *   i.e. the contract the UI relies on for the consent-gated breakdown flow.
 *   The pure service-layer correctness (threshold math, breakdown cardinality,
 *   parent auto-completion) is already covered by
 *   `recovery-mode.property.test.ts` (Properties 13–14); this file pins the
 *   *behaviour the modal depends on*:
 *
 *     1. Modal display gate — `shouldOfferRecoveryMode` is true iff the
 *        cumulative score exceeds 8000 (Requirement 7.1, 14.3.1), and the
 *        candidates action surfaces the tasks the modal renders.
 *     2. "Nanti Saja" dismissal — closing the modal without activating writes
 *        nothing; no sub-tasks are created without explicit consent.
 *     3. Task breakdown with user selection — `activateRecoveryModeAction`
 *        breaks down ONLY the tasks the user checked, ignoring the rest.
 *     4. SubTask creation with staggered deadlines — every created sub-task is
 *        flagged `isSubTask`, linked to its parent, with deadlines spaced 1–2
 *        days apart and weights summing back to the parent (Requirement 7.6).
 *     5. Cooked Meter recalculation excluding SubTasks — after activation the
 *        cumulative score is computed from PARENT tasks only, so the freshly
 *        created sub-tasks do not inflate the stress meter (Requirement 7.8).
 *
 * The Framer Motion modal itself cannot be driven in vitest's node environment,
 * so we assert the *contract* those mechanics depend on (the same approach the
 * task-queue integration test takes for drag-and-drop). The actions faithfully
 * persist/reject and the services correctly compute the post-mutation state.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.8, 14.3.1, 14.3.2.
 */

// ─── Mock harness (mirror of the established integration-test pattern) ───────
//
// vi.hoisted ensures the stubs exist before the hoisted vi.mock runs. We stub
// the minimal Prisma surface exercised by RecoveryModeService +
// CookedMeterService. `@/auth`, `@/i18n/server` are Next-only and are stubbed
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
      taskEditLog: { createMany: fn() },
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
 * the freshly-built in-memory client. Mirrors task-queue.integration.test.ts.
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
  getRecoveryCandidatesAction,
  activateRecoveryModeAction,
} from "@/app/actions/recovery";
import { RecoveryModeService } from "@/lib/services/recovery-mode.service";
import { CookedMeterService } from "@/lib/services/cooked-meter.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

// ─── Test helpers ───────────────────────────────────────────────────────────

const NOW = new Date("2026-07-02T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Seed a user. The action layer only needs `session.user.id`, but we create a
 * full record for store consistency.
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
 * CUID-shaped id generator (24 chars). Keeps ids realistic and consistent
 * with the rest of the integration suite.
 */
function cuidId(n: number): string {
  return "ck" + String(n).padStart(22, "0");
}

/**
 * Seed a parent task + its UserTaskProgress bridge row directly into the
 * in-memory store (bypassing the client so we control ids deterministically).
 *
 * @param daysAhead  Deadline offset from NOW. ≤7 keeps the task inside the
 *                   Cooked Meter's 7-day window so it contributes to the score.
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
    position: null,
    completedAt: null,
    currentStressScore: 0,
  });

  return taskId;
}

/** Drive `auth()` to return an authenticated session for `userId`. */
function givenSignedInAs(userId: string): void {
  mockAuthFn.mockResolvedValue({ user: { id: userId } });
}

// ─── 1. Modal display gate (Requirements 7.1, 14.3.1) ───────────────────────
//
// RecoveryModeModal is rendered by the dashboard when the Cooked Meter crosses
// the OVERCOOKED threshold. The modal's visibility is driven by
// `CookedMeterService.shouldOfferRecoveryMode`, and its body is populated by
// `getRecoveryCandidatesAction`. This block pins both halves of that gate.

describe("Task 11.6.1 — Modal display when cumulativeScore > 8000 (Requirements 7.1, 14.3.1)", () => {
  it("offers Recovery Mode and surfaces candidates when the user is OVERCOOKED", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // One heavy parent inside the 7-day window pushes the score past 8000.
    // (sks 5 × weight 9000 × 3 days → ~8458 cumulative, see priority engine.)
    seedTask(userId, 1, { taskWeight: 9000, sksWeight: 5, daysAhead: 3 });

    const offer = await CookedMeterService.shouldOfferRecoveryMode(userId, NOW);
    expect(offer).toBe(true);

    const score = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    expect(score).toBeGreaterThan(8000);

    // The candidates action returns the tasks the modal renders as checkboxes.
    const result = await getRecoveryCandidatesAction();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe(cuidId(1));
    expect(result.data[0]?.taskWeight).toBe(9000);
  });

  it("does NOT offer Recovery Mode when the score is at or below 8000", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // A single low-weight parent keeps the user below the threshold.
    seedTask(userId, 1, { taskWeight: 1000, sksWeight: 1, daysAhead: 5 });

    const score = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    expect(score).toBeLessThanOrEqual(8000);

    const offer = await CookedMeterService.shouldOfferRecoveryMode(userId, NOW);
    expect(offer).toBe(false);
  });

  it("rejects the candidates action for an unauthenticated session (Requirement 1.6)", async () => {
    seedUser();
    // No givenSignedInAs → auth() returns null.

    const result = await getRecoveryCandidatesAction();

    expect(result.success).toBe(false);
  });

  it("returns no candidates when the only heavy tasks are SubTasks or below the weight floor", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // Distractors that must NOT appear as breakdown candidates.
    seedTask(userId, 1, { taskWeight: 2000, sksWeight: 3 }); // ≤ 3000 weight
    seedTask(userId, 2, {
      taskWeight: 9000,
      sksWeight: 5,
      isSubTask: true,
      parentTaskId: "task_x",
    });

    const result = await getRecoveryCandidatesAction();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual([]);
  });
});

// ─── 2. "Nanti Saja" dismissal (Requirements 7.1, 14.3.2) ───────────────────
//
// The "Nanti Saja" button in RecoveryModeModal only calls `onClose()` — it
// never calls `activateRecoveryModeAction`. The contract the dismissal depends
// on: with no activation call, the store is untouched and no sub-tasks exist.
// We also verify the activation action itself refuses an empty selection,
// which is the defence-in-depth guarantee that dismissal can never create
// sub-tasks.

describe('Task 11.6.2 — Modal dismissal on "Nanti Saja" (Requirements 7.1, 14.3.2)', () => {
  it("creates no sub-tasks when the user dismisses without activating", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const heavy = seedTask(userId, 1, { taskWeight: 9000, sksWeight: 5, daysAhead: 3 });

    // The user is offered Recovery Mode…
    const offer = await CookedMeterService.shouldOfferRecoveryMode(userId, NOW);
    expect(offer).toBe(true);

    // …but clicks "Nanti Saja" → the modal closes WITHOUT calling the action.
    // (We simulate that by simply never invoking activateRecoveryModeAction.)
    const store = getInMemoryStore();
    const subTasksAfterDismiss = Array.from(store.tasks.values()).filter(
      (t) => t.isSubTask,
    );
    expect(subTasksAfterDismiss).toHaveLength(0);
    // Parent task untouched.
    expect(store.tasks.get(heavy)?.isSubTask).toBe(false);
    expect(store.userTaskProgress.get(`${userId}/${heavy}`)?.status).toBe("PENDING");
  });

  it("rejects activation with an empty selection — consent is mandatory", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    seedTask(userId, 1, { taskWeight: 9000, sksWeight: 5, daysAhead: 3 });

    const result = await activateRecoveryModeAction({ taskIdsToBreakdown: [] });

    expect(result.success).toBe(false);
    // Defence-in-depth: nothing was created.
    const subTasks = Array.from(getInMemoryStore().tasks.values()).filter(
      (t) => t.isSubTask,
    );
    expect(subTasks).toHaveLength(0);
  });

  it("does not auto-activate even when the user is deeply OVERCOOKED", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // Two heavy parents → cumulative well above 8000.
    seedTask(userId, 1, { taskWeight: 9000, sksWeight: 5, daysAhead: 3 });
    seedTask(userId, 2, { taskWeight: 9000, sksWeight: 5, daysAhead: 4 });

    const score = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    expect(score).toBeGreaterThan(8000);

    // The offer is just a boolean — activation requires an explicit action call
    // that we deliberately do NOT make here.
    const store = getInMemoryStore();
    expect(Array.from(store.tasks.values()).filter((t) => t.isSubTask)).toHaveLength(0);
  });
});

// ─── 3. Task breakdown with user selection (Requirements 7.2, 7.3) ──────────
//
// The modal pre-selects every candidate but lets the user uncheck any. The
// activation action must break down ONLY the checked ids and return the full
// breakdown payload the success state renders.

describe("Task 11.6.3 — Task breakdown with user selection (Requirements 7.2, 7.3)", () => {
  it("breaks down only the tasks the user explicitly selected", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const a = seedTask(userId, 1, { taskWeight: 8000, sksWeight: 4, daysAhead: 4 });
    const b = seedTask(userId, 2, { taskWeight: 7000, sksWeight: 4, daysAhead: 5 });
    const c = seedTask(userId, 3, { taskWeight: 6000, sksWeight: 3, daysAhead: 6 });

    // The user consents to breaking down `a` and `c` only.
    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [a, c],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Two breakdown entries — one per selected parent.
    expect(result.data.tasksBreakdown).toHaveLength(2);
    const brokenParentIds = result.data.tasksBreakdown
      .map((e) => e.parentTaskId)
      .sort();
    expect(brokenParentIds).toEqual([a, c].sort());

    // `b` was never selected → no sub-task should reference it.
    const store = getInMemoryStore();
    const orphans = Array.from(store.tasks.values()).filter(
      (t) => t.parentTaskId === b,
    );
    expect(orphans).toHaveLength(0);

    // Every breakdown entry carries a non-empty motivational text (Req 7.9).
    expect(typeof result.data.motivationalText).toBe("string");
    expect(result.data.motivationalText.length).toBeGreaterThan(0);
    // activatedAt is serialized as an ISO string across the server/client boundary.
    expect(typeof result.data.activatedAt).toBe("string");
    expect(new Date(result.data.activatedAt).getTime()).not.toBeNaN();
  });

  it("creates a PENDING UserTaskProgress row for every generated sub-task", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const parent = seedTask(userId, 1, { taskWeight: 6000, sksWeight: 3, daysAhead: 5 });

    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [parent],
    });
    expect(result.success).toBe(true);

    const store = getInMemoryStore();
    const subProgress = Array.from(store.userTaskProgress.values()).filter(
      (p) => p.userId === userId && p.taskId !== parent,
    );
    // Every sub-task has its own bridge row in PENDING state.
    expect(subProgress.length).toBeGreaterThanOrEqual(3);
    for (const p of subProgress) {
      expect(p.status).toBe("PENDING");
    }
  });

  it("rejects activation when the user does not own one of the selected tasks", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const mine = seedTask(userId, 1, { taskWeight: 6000, sksWeight: 3, daysAhead: 5 });
    // Seed a task owned by a different user with no progress row for `userId`.
    const other = seedUser("user_other");
    const foreignTask = seedTask(other, 2, { taskWeight: 6000, sksWeight: 3, daysAhead: 5 });

    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [mine, foreignTask],
    });

    // The service throws ValidationError for the unowned task → action maps to failure.
    expect(result.success).toBe(false);
    // No sub-tasks created for either task (the loop throws before persisting
    // the foreign task's breakdown; `mine` may have been processed first, so we
    // only assert the foreign parent has no children).
    const store = getInMemoryStore();
    const foreignChildren = Array.from(store.tasks.values()).filter(
      (t) => t.parentTaskId === foreignTask,
    );
    expect(foreignChildren).toHaveLength(0);
  });

  it("rejects activation for an unauthenticated session", async () => {
    const userId = seedUser();
    seedTask(userId, 1, { taskWeight: 6000, sksWeight: 3, daysAhead: 5 });
    // No givenSignedInAs → auth() returns null.

    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [cuidId(1)],
    });

    expect(result.success).toBe(false);
    expect(
      Array.from(getInMemoryStore().tasks.values()).filter((t) => t.isSubTask),
    ).toHaveLength(0);
  });
});

// ─── 4. SubTask creation with staggered deadlines (Requirement 7.6) ─────────
//
// The modal's success state renders each created sub-task with its deadline.
// This block pins the structural invariants of those sub-tasks: cardinality
// (3–5), the isSubTask/parentTaskId flags, proportional weights summing back
// to the parent, and deadlines spaced 1–2 days apart.

describe("Task 11.6.4 — SubTask creation with staggered deadlines (Requirement 7.6)", () => {
  it("creates 3–5 sub-tasks per parent with weights summing to the parent and deadlines 1–2 days apart", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const parent = seedTask(userId, 1, { taskWeight: 6000, sksWeight: 3, daysAhead: 6 });

    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [parent],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const breakdown = result.data.tasksBreakdown[0];
    expect(breakdown).toBeDefined();
    const subViews = breakdown!.subTasks;

    // (a) Cardinality constrained to 3–5 (Requirement 7.6).
    expect(subViews.length).toBeGreaterThanOrEqual(3);
    expect(subViews.length).toBeLessThanOrEqual(5);

    // (b) Every sub-task view is serializable (ISO deadline) for the client.
    let weightSum = 0;
    const deadlines: number[] = [];
    for (const sub of subViews) {
      expect(typeof sub.id).toBe("string");
      expect(typeof sub.title).toBe("string");
      expect(typeof sub.taskWeight).toBe("number");
      expect(sub.taskWeight).toBeGreaterThan(0);
      weightSum += sub.taskWeight;
      const ms = new Date(sub.deadlineAt).getTime();
      expect(ms).not.toBeNaN();
      deadlines.push(ms);
    }

    // (c) Weights sum back to the parent weight.
    expect(weightSum).toBe(6000);

    // (d) Deadlines strictly increasing, each gap 1–2 days.
    for (let i = 1; i < deadlines.length; i++) {
      const gapDays = (deadlines[i]! - deadlines[i - 1]!) / MS_PER_DAY;
      expect(gapDays).toBeGreaterThanOrEqual(1);
      expect(gapDays).toBeLessThanOrEqual(2);
    }

    // (e) Cross-check the persisted rows carry the structural flags.
    const store = getInMemoryStore();
    const persisted = Array.from(store.tasks.values()).filter(
      (t) => t.parentTaskId === parent,
    );
    expect(persisted).toHaveLength(subViews.length);
    for (const t of persisted) {
      expect(t.isSubTask).toBe(true);
      expect(t.parentTaskId).toBe(parent);
    }
  });

  it("preserves the parent task's SKS weight on every created sub-task", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const parent = seedTask(userId, 1, { taskWeight: 5000, sksWeight: 4, daysAhead: 5 });

    await activateRecoveryModeAction({ taskIdsToBreakdown: [parent] });

    const store = getInMemoryStore();
    const subs = Array.from(store.tasks.values()).filter(
      (t) => t.parentTaskId === parent,
    );
    for (const s of subs) {
      expect(s.sksWeight).toBe(4);
    }
  });
});

// ─── 5. Cooked Meter recalculation excluding SubTasks (Requirement 7.8) ──────
//
// After activation, the dashboard re-fetches the Cooked Meter. The contract:
// the meter sums PARENT tasks only, so the newly created sub-tasks (which can
// be heavy) must NOT inflate the score. This is the anti-inflation guarantee
// the post-activation UI relies on — the user should see their score DROP or
// stay flat, never spike, after breaking a task down.

describe("Task 11.6.5 — Cooked Meter recalculation excluding SubTasks (Requirement 7.8)", () => {
  it("does not count freshly created sub-tasks toward the cumulative score", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // Parent heavy enough to qualify for breakdown AND to be in the 7-day window.
    const parent = seedTask(userId, 1, { taskWeight: 9000, sksWeight: 5, daysAhead: 4 });

    const scoreBefore = await CookedMeterService.calculateCumulativeScore(userId, NOW);

    // Activate → creates 3–5 sub-tasks (each potentially heavy) under `parent`.
    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [parent],
    });
    expect(result.success).toBe(true);

    const scoreAfter = await CookedMeterService.calculateCumulativeScore(userId, NOW);

    // The sub-tasks must NOT inflate the score: the meter still equals the
    // parent-only contribution. (The parent itself remains PENDING and inside
    // the 7-day window, so it is still counted — the point is the children add
    // nothing on top.)
    expect(scoreAfter).toBe(scoreBefore);

    // Sanity: there really ARE sub-tasks in the store that would otherwise
    // dominate the score if they were counted.
    const store = getInMemoryStore();
    const subTasks = Array.from(store.tasks.values()).filter(
      (t) => t.parentTaskId === parent,
    );
    expect(subTasks.length).toBeGreaterThanOrEqual(3);
    const childWeightSum = subTasks.reduce((sum, t) => sum + t.taskWeight, 0);
    expect(childWeightSum).toBe(9000);
  });

  it("counts a second parent task but never its sub-tasks", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    const parentA = seedTask(userId, 1, { taskWeight: 6000, sksWeight: 3, daysAhead: 4 });
    const parentB = seedTask(userId, 2, { taskWeight: 6000, sksWeight: 3, daysAhead: 5 });

    // Break down only parentA. parentB stays a parent.
    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [parentA],
    });
    expect(result.success).toBe(true);

    const score = await CookedMeterService.calculateCumulativeScore(userId, NOW);

    // The score must reflect parentA + parentB only — parentA's children are
    // excluded by the isSubTask=false filter (Requirement 7.8).
    const store = getInMemoryStore();
    const aChildren = Array.from(store.tasks.values()).filter(
      (t) => t.parentTaskId === parentA,
    );
    expect(aChildren.length).toBeGreaterThanOrEqual(3);

    // Compute the expected parent-only score directly from the engine to avoid
    // tautology: sum JIT priority of the two parents, ignore all children.
    const parents = [store.tasks.get(parentA)!, store.tasks.get(parentB)!];
    const scoreA = computeJitPriority(parents[0]!, NOW);
    const scoreB = computeJitPriority(parents[1]!, NOW);
    expect(score).toBe(scoreA + scoreB);
  });

  it("drops the cumulative score below the threshold once the parent is completed", async () => {
    const userId = seedUser();
    givenSignedInAs(userId);
    // Two medium-heavy parents → together OVERCOOKED, but each alone ≤ 8000.
    // (sks 4 × weight 7000 at 3 days ≈ 6858; at 4 days ≈ 6600 → sum ≈ 13458.)
    const keep = seedTask(userId, 1, { taskWeight: 7000, sksWeight: 4, daysAhead: 3 });
    const breakDown = seedTask(userId, 2, { taskWeight: 7000, sksWeight: 4, daysAhead: 4 });

    const scoreBefore = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    expect(scoreBefore).toBeGreaterThan(8000);

    // Break down one parent, then complete it (simulating the user finishing
    // all sub-tasks → parent auto-completes).
    const result = await activateRecoveryModeAction({
      taskIdsToBreakdown: [breakDown],
    });
    expect(result.success).toBe(true);

    // Mark every sub-task COMPLETED, which should auto-complete the parent.
    const store = getInMemoryStore();
    const subs = Array.from(store.tasks.values()).filter(
      (t) => t.parentTaskId === breakDown,
    );
    for (const sub of subs) {
      await client.userTaskProgress.update({
        where: { userId_taskId: { userId, taskId: sub.id } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
    const parentDone = await RecoveryModeService.checkParentCompletion(breakDown, userId);
    expect(parentDone).toBe(true);

    const scoreAfter = await CookedMeterService.calculateCumulativeScore(userId, NOW);
    // Only `keep` remains counted → score drops below the threshold.
    expect(scoreAfter).toBeLessThan(scoreBefore);
    expect(scoreAfter).toBeLessThanOrEqual(8000);
    // `keep` is still tracked as a parent.
    expect(store.tasks.get(keep)?.isSubTask).toBe(false);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Minimal mirror of PriorityEngineService.calculatePriorityScore for the
 * parent-only expected-score assertion. Kept local to avoid coupling this
 * integration test to the engine's internal sort helpers.
 */
function computeJitPriority(
  task: { sksWeight: number; taskWeight: number; deadlineAt: Date },
  now: Date,
): number {
  const hoursRemaining = (task.deadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  let timeUrgency: number;
  if (hoursRemaining < 24) {
    timeUrgency = 10000;
  } else {
    const daysRemaining = hoursRemaining / 24;
    if (daysRemaining > 7) {
      const normalized = Math.max(0, Math.min(1, (30 - daysRemaining) / 23));
      timeUrgency = Math.floor(normalized * 3000);
    } else {
      const exp = 8000 - Math.pow(daysRemaining, 1.5) * 714;
      timeUrgency = Math.floor(Math.max(3000, Math.min(8000, exp)));
    }
  }
  const sksComponent = Math.floor(task.sksWeight * 2000 * 0.4);
  const taskComponent = Math.floor(task.taskWeight * 0.4);
  const timeComponent = Math.floor(timeUrgency * 0.2);
  return Math.min(10000, Math.max(0, sksComponent + taskComponent + timeComponent));
}
