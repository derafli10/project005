import "server-only";

import { baseDb, db, withUserContext } from "@/lib/db";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import {
  PriorityEngineService,
  type TaskWithPriorityScore,
} from "./priority-engine.service";
import type {
  Task,
  TaskStatus,
  UserTaskProgress,
  CookedTier,
  Prisma,
} from "@/generated/prisma";

/**
 * Task Service
 *
 * Implements CRUD and queue logic for tasks. Key behaviours:
 *  - `createTask` writes the shared `Task` row plus a `UserTaskProgress` bridge
 *    row; when a `classRoomId` is supplied, bridge rows are propagated to every
 *    classroom member (Many-to-Many bridge pattern — Requirement 8.7).
 *  - `getUserTasks` returns the user's queue with JIT priority scores and the
 *    hybrid sort: position ASC (nulls last) → priorityScore DESC → deadlineAt
 *    ASC (Requirements 4.2, 4.3, 4.7).
 *  - `completeTask` flips the bridge status and detects the Academic Comeback
 *    celebration trigger (Requirement 4.9, 12.1).
 *  - `recordOverride` persists the drag-and-drop override + reason
 *    (Requirement 5.6).
 *
 * Tenant isolation: user-scoped reads/writes go through the extended `db`
 * client inside `withUserContext`. Cross-tenant propagation uses `baseDb`.
 *
 * Reference: design.md > Task Service, Requirements 4.1–4.10, 5.1–5.10.
 */

/** OVERCOOKED threshold — used for Academic Comeback detection. */
export const OVERCOOKED_THRESHOLD = 8000;

/** Input for creating a task. */
export interface CreateTaskInput {
  title: string;
  description?: string;
  taskWeight: number; // 0–10000 basis points
  sksWeight?: number; // 1–5 (defaults to classroom or 3)
  deadlineAt: Date;
  classRoomId?: string; // when set, task is shared with the classroom
}

/** Input for updating a task (partial). */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  taskWeight?: number;
  sksWeight?: number;
  deadlineAt?: Date;
}

/** Result of {@link TaskService.completeTask}. */
export interface CompleteTaskResult {
  task: Task;
  /** True when the completion should fire the Academic Comeback celebration. */
  triggerCelebration: boolean;
  /** Drop in cumulative stress score (before − after). 0 when no celebration. */
  stressDrop: number;
  oldTier?: CookedTier;
  newTier?: CookedTier;
}

/**
 * A task row in the user's queue, decorated with its JIT priority score and
 * the per-user progress/state pulled from the UserTaskProgress bridge.
 */
export interface QueueTask extends TaskWithPriorityScore<{
  id: string;
  title: string;
  description: string | null;
  sksWeight: number;
  taskWeight: number;
  deadlineAt: Date;
  isSubTask: boolean;
  parentTaskId: string | null;
  classRoomId: string | null;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}> {
  /** Per-user progress state from the bridge. */
  progress: {
    status: TaskStatus;
    position: number | null;
    completedAt: Date | null;
  };
  /** Human-readable micro-prompt (Requirement 4.5). */
  microPrompt: string;
}

/** Maps a cumulative score to a CookedTier (Requirement 6.3–6.6). */
export function determineCookedTier(cumulativeScore: number): CookedTier {
  if (cumulativeScore <= 2000) return "MAIN_CHARACTER";
  if (cumulativeScore <= 5000) return "LET_HIM_COOK";
  if (cumulativeScore <= 8000) return "SLIGHTLY_COOKED";
  return "OVERCOOKED";
}

export class TaskService {
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Create a new task. Writes the shared Task row plus a UserTaskProgress
   * bridge row for the creator. When `classRoomId` is supplied, bridge rows
   * are propagated to every classroom member atomically (Requirement 8.7).
   */
  static async createTask(
    userId: string,
    input: CreateTaskInput
  ): Promise<Task> {
    // 1. Validate inputs.
    if (!input.title || input.title.trim().length === 0 || input.title.length > 255) {
      throw new ValidationError("title must be 1–255 characters", { field: "title" });
    }
    if (
      !Number.isInteger(input.taskWeight) ||
      input.taskWeight < 0 ||
      input.taskWeight > 10000
    ) {
      throw new ValidationError("taskWeight must be an integer 0–10000", {
        field: "taskWeight",
      });
    }
    if (input.sksWeight !== undefined) {
      if (!Number.isInteger(input.sksWeight) || input.sksWeight < 1 || input.sksWeight > 5) {
        throw new ValidationError("sksWeight must be an integer 1–5", {
          field: "sksWeight",
        });
      }
    }
    if (!(input.deadlineAt instanceof Date) || Number.isNaN(input.deadlineAt.getTime())) {
      throw new ValidationError("deadlineAt must be a valid Date", {
        field: "deadlineAt",
      });
    }
    if (input.deadlineAt.getTime() <= Date.now()) {
      throw new ValidationError("deadline must be in the future", {
        field: "deadlineAt",
      });
    }

    // 2. Resolve effective SKS weight (explicit > classroom default > 3).
    let sksWeight = input.sksWeight;
    if (input.classRoomId) {
      const classroom = await baseDb.classRoom.findUnique({
        where: { id: input.classRoomId },
        select: { sksWeight: true },
      });
      if (!classroom) {
        throw new NotFoundError("ClassRoom", input.classRoomId);
      }
      if (sksWeight === undefined) sksWeight = classroom.sksWeight;
    }
    if (sksWeight === undefined) sksWeight = 3;

    // 3. Atomic create + propagate via the un-scoped client (we are writing
    //    bridge rows for many users — cannot be auto-scoped to a single userId).
    return baseDb.$transaction(async (tx) => {
      // Verify membership if classroom was specified.
      if (input.classRoomId) {
        const membership = await tx.classRoomMember.findUnique({
          where: {
            classRoomId_userId: { classRoomId: input.classRoomId, userId },
          },
          select: { userId: true },
        });
        if (!membership) {
          throw new AuthorizationError(
            "User must be a member of the classroom to create a task in it"
          );
        }
      }

      const task = await tx.task.create({
        data: {
          title: input.title.trim(),
          description: input.description ?? null,
          taskWeight: input.taskWeight,
          sksWeight,
          deadlineAt: input.deadlineAt,
          classRoomId: input.classRoomId ?? null,
          creatorId: userId,
          isSubTask: false,
        },
      });

      // 3a. Bridge row for the creator.
      await tx.userTaskProgress.create({
        data: { userId, taskId: task.id, status: "PENDING" },
      });

      // 3b. Propagate to all other classroom members (Requirement 8.7).
      if (input.classRoomId) {
        const members = await tx.classRoomMember.findMany({
          where: {
            classRoomId: input.classRoomId,
            userId: { not: userId },
          },
          select: { userId: true },
        });

        if (members.length > 0) {
          // skipDuplicates guards against an (unlikely) pre-existing bridge row.
          await tx.userTaskProgress.createMany({
            data: members.map((m) => ({
              userId: m.userId,
              taskId: task.id,
              status: "PENDING" as TaskStatus,
            })),
            skipDuplicates: true,
          });
        }
      }

      return task;
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Fetch the user's task queue via the UserTaskProgress bridge and decorate
   * each row with its JIT priority score. Applies the hybrid sort:
   *
   *   1. position ASC, NULLs last           (manual override first)
   *   2. priorityScore DESC                  (JIT evaluation)
   *   3. deadlineAt ASC                      (tertiary tiebreaker)
   *
   * Requirements 4.2, 4.3, 4.7.
   *
   * @param userId     The authenticated user's id
   * @param statuses   Optional status filter (defaults to active tasks).
   * @param now        Reference timestamp for JIT evaluation (injectable).
   */
  static async getUserTasks(
    userId: string,
    statuses: TaskStatus[] = ["PENDING", "IN_PROGRESS"],
    now: Date = new Date()
  ): Promise<QueueTask[]> {
    // Query through the bridge table (Requirement 4.7). Use baseDb with an
    // explicit userId filter — the JIT decoration is user-specific but the
    // underlying Task rows are shared, so we must not double-scope via the
    // creatorId extension.
    const rows = await baseDb.userTaskProgress.findMany({
      where: { userId, status: { in: statuses } },
      include: {
        task: true,
      },
    });

    const nowMs = now.getTime();

    // Decorate each row with a JIT priority score. Tasks past their deadline
    // get urgency 10000 (SLA breach) but are still returned.
    const decorated: QueueTask[] = [];
    for (const row of rows) {
      const t = row.task;
      const hoursRemaining = (t.deadlineAt.getTime() - nowMs) / (1000 * 60 * 60);
      const timeUrgency = PriorityEngineService.calculateTimeUrgency(hoursRemaining);

      const sksComponent = Math.floor(t.sksWeight * 2000 * 0.4);
      const taskComponent = Math.floor(t.taskWeight * 0.4);
      const timeComponent = Math.floor(timeUrgency * 0.2);
      const priorityScore = Math.min(
        10000,
        Math.max(0, sksComponent + taskComponent + timeComponent)
      );

      decorated.push({
        task: {
          id: t.id,
          title: t.title,
          description: t.description,
          sksWeight: t.sksWeight,
          taskWeight: t.taskWeight,
          deadlineAt: t.deadlineAt,
          isSubTask: t.isSubTask,
          parentTaskId: t.parentTaskId,
          classRoomId: t.classRoomId,
          creatorId: t.creatorId,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        },
        priorityScore,
        timeUrgency,
        progress: {
          status: row.status,
          position: row.position,
          completedAt: row.completedAt,
        },
        microPrompt: PriorityEngineService.generateMicroPrompt(t, now),
      });
    }

    // Hybrid sort — Requirement 4.2, 4.3.
    decorated.sort((a, b) => {
      const ap = a.progress.position;
      const bp = b.progress.position;

      // (1) position ASC, NULLs last
      if (ap !== null && bp === null) return -1;
      if (ap === null && bp !== null) return 1;
      if (ap !== null && bp !== null && ap !== bp) return ap - bp;

      // (2) priorityScore DESC
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }

      // (3) deadlineAt ASC
      return a.task.deadlineAt.getTime() - b.task.deadlineAt.getTime();
    });

    return decorated;
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Update a shared task. Only the original creator may edit (Requirement 9.10).
   * Because the Task is the single source of truth (M:N architecture), a single
   * UPDATE applies to every member automatically — no row duplication.
   *
   * TaskEditLog rows are written for each changed field (Requirement 9.1, 9.2).
   */
  static async updateTask(
    taskId: string,
    userId: string,
    updates: UpdateTaskInput
  ): Promise<Task> {
    const task = await baseDb.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundError("Task", taskId);

    // Requirement 9.10 — only the creator can edit.
    if (task.creatorId !== userId) {
      throw new AuthorizationError("Only the task creator can edit this task");
    }

    // Validate numeric fields if present.
    if (
      updates.taskWeight !== undefined &&
      (!Number.isInteger(updates.taskWeight) ||
        updates.taskWeight < 0 ||
        updates.taskWeight > 10000)
    ) {
      throw new ValidationError("taskWeight must be an integer 0–10000");
    }
    if (
      updates.sksWeight !== undefined &&
      (!Number.isInteger(updates.sksWeight) ||
        updates.sksWeight < 1 ||
        updates.sksWeight > 5)
    ) {
      throw new ValidationError("sksWeight must be an integer 1–5");
    }
    if (
      updates.deadlineAt !== undefined &&
      (!(updates.deadlineAt instanceof Date) ||
        Number.isNaN(updates.deadlineAt.getTime()))
    ) {
      throw new ValidationError("deadlineAt must be a valid Date");
    }
    if (
      updates.title !== undefined &&
      (updates.title.trim().length === 0 || updates.title.length > 255)
    ) {
      throw new ValidationError("title must be 1–255 characters");
    }

    return baseDb.$transaction(async (tx) => {
      const data: Prisma.TaskUpdateInput = {};
      const editLogs: Prisma.TaskEditLogCreateManyInput[] = [];

      const track = (
        fieldName: string,
        oldValue: string | number | Date | null,
        newValue: string | number | Date | null
      ) => {
        const oldStr = oldValue instanceof Date ? oldValue.toISOString() : String(oldValue);
        const newStr = newValue instanceof Date ? newValue.toISOString() : String(newValue);
        if (oldStr !== newStr) {
          editLogs.push({
            taskId,
            editorId: userId,
            fieldName,
            oldValue: oldStr,
            newValue: newStr,
          });
        }
      };

      if (updates.title !== undefined) {
        track("title", task.title, updates.title.trim());
        data.title = updates.title.trim();
      }
      if (updates.description !== undefined) {
        track("description", task.description, updates.description);
        data.description = updates.description;
      }
      if (updates.taskWeight !== undefined) {
        track("taskWeight", task.taskWeight, updates.taskWeight);
        data.taskWeight = updates.taskWeight;
      }
      if (updates.sksWeight !== undefined) {
        track("sksWeight", task.sksWeight, updates.sksWeight);
        data.sksWeight = updates.sksWeight;
      }
      if (updates.deadlineAt !== undefined) {
        track("deadlineAt", task.deadlineAt, updates.deadlineAt);
        data.deadlineAt = updates.deadlineAt;
      }

      const updated =
        Object.keys(data).length > 0
          ? await tx.task.update({ where: { id: taskId }, data })
          : task;

      if (editLogs.length > 0) {
        await tx.taskEditLog.createMany({ data: editLogs });
      }

      return updated;
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Mark a task as COMPLETED for the current user and detect the Academic
   * Comeback celebration trigger (Requirements 4.9, 12.1).
   *
   * The "stress drop" is the delta between the user's cumulative score before
   * and after the completion (Requirement 12.5). The celebration fires only
   * when the user was previously in the OVERCOOKED tier.
   */
  static async completeTask(
    taskId: string,
    userId: string
  ): Promise<CompleteTaskResult> {
    // Idempotency: if already completed, short-circuit with no celebration.
    const existing = await baseDb.userTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (!existing) {
      throw new NotFoundError("UserTaskProgress", `${userId}/${taskId}`);
    }
    if (existing.status === "COMPLETED") {
      return {
        task: await baseDb.task.findUniqueOrThrow({ where: { id: taskId } }),
        triggerCelebration: false,
        stressDrop: 0,
      };
    }

    // Snapshot the cumulative stress score BEFORE completion.
    const beforeQueue = await this.getUserTasks(
      userId,
      ["PENDING", "IN_PROGRESS"],
      new Date()
    );
    const beforeScore = this.sumParentScores(beforeQueue);
    const oldTier = determineCookedTier(beforeScore);

    // Flip the bridge row.
    const now = new Date();
    await baseDb.userTaskProgress.update({
      where: { userId_taskId: { userId, taskId } },
      data: { status: "COMPLETED", completedAt: now },
    });

    // Snapshot the cumulative stress score AFTER completion.
    const afterQueue = await this.getUserTasks(
      userId,
      ["PENDING", "IN_PROGRESS"],
      now
    );
    const afterScore = this.sumParentScores(afterQueue);
    const newTier = determineCookedTier(afterScore);
    const stressDrop = Math.max(0, beforeScore - afterScore);

    // Celebration fires only when the user was OVERCOOKED before completion.
    const triggerCelebration = oldTier === "OVERCOOKED";

    const task = await baseDb.task.findUniqueOrThrow({ where: { id: taskId } });

    return { task, triggerCelebration, stressDrop, oldTier, newTier };
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Record a manual drag-and-drop override (Requirement 5.6). Saves a
   * TaskOverride row AND updates the bridge `position` so the hybrid sort
   * surfaces the manual placement.
   */
  static async recordOverride(
    taskId: string,
    userId: string,
    oldPosition: number,
    newPosition: number,
    reason: string
  ): Promise<void> {
    if (!reason || reason.trim().length < 3 || reason.length > 500) {
      throw new ValidationError("reason must be 3–500 characters");
    }
    if (!Number.isInteger(oldPosition) || oldPosition < 0) {
      throw new ValidationError("oldPosition must be a non-negative integer");
    }
    if (!Number.isInteger(newPosition) || newPosition < 0) {
      throw new ValidationError("newPosition must be a non-negative integer");
    }
    if (oldPosition === newPosition) {
      // Nothing to do — no actual reorder.
      return;
    }

    const progress = await baseDb.userTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (!progress) {
      throw new NotFoundError("UserTaskProgress", `${userId}/${taskId}`);
    }

    await baseDb.$transaction([
      baseDb.taskOverride.create({
        data: {
          userId,
          taskId,
          reason: reason.trim(),
        },
      }),
      baseDb.userTaskProgress.update({
        where: { userId_taskId: { userId, taskId } },
        data: { position: newPosition },
      }),
    ]);
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Sum the JIT priority scores of PARENT tasks only (SubTasks excluded —
   * Requirement 7.8). Used internally for Cooked Meter / Comeback detection.
   * Exposed statically so the Cooked Meter service can reuse it.
   */
  static sumParentScores(queue: QueueTask[]): number {
    return queue
      .filter((q) => !q.task.isSubTask)
      .reduce((sum, q) => sum + q.priorityScore, 0);
  }
}

/** Default singleton for ergonomic imports. */
export const taskService = TaskService;

// Re-export for downstream services (Cooked Meter, Recovery Mode, etc.).
export { withUserContext };
export type { UserTaskProgress };
