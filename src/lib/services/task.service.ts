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
import { invalidateCookedScoreCache } from "./cooked-meter.service";

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

/**
 * Celebration context for the Academic Comeback modal (Requirements 12.1, 12.5, 12.6).
 * Populated only when the user completes a task while in the OVERCOOKED tier.
 */
export interface CelebrationContext {
  /** The user's Cooked Tier BEFORE the task was completed. Always OVERCOOKED. */
  oldTier: CookedTier;
  /** The user's Cooked Tier AFTER the task was completed. */
  newTier: CookedTier;
  /** Cumulative score drop (before − after) in basis points. */
  stressDrop: number;
  /** The completed task's individual taskWeight (for display). */
  completedTaskWeight: number;
}

/** Result of {@link TaskService.completeTask}. */
export interface CompleteTaskResult {
  task: Task;
  /** True when the completion should fire the Academic Comeback celebration. */
  triggerCelebration: boolean;
  /** Drop in cumulative stress score (before − after). 0 when no celebration. */
  stressDrop: number;
  /** The user's Cooked Tier BEFORE the completion. */
  oldTier: CookedTier;
  /** The user's Cooked Tier AFTER the completion. */
  newTier: CookedTier;
  /**
   * Populated only when `triggerCelebration` is true. Contains all data
   * needed to render the Academic Comeback modal (Requirement 12.6).
   */
  celebrationContext: CelebrationContext | null;
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
  /** Count of unread changes for this task (Task 13.2). */
  unreadLogsCount: number;
}

/** A single audit-trail entry for the Task Edit History timeline (Requirement 9.1, 9.4, 9.6). */
export interface TaskEditHistoryEntry {
  id: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  editedAt: Date;
  editorId: string;
  editorName: string;
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
    input: CreateTaskInput,
  ): Promise<Task> {
    // 1. Validate inputs.
    if (
      !input.title ||
      input.title.trim().length === 0 ||
      input.title.length > 255
    ) {
      throw new ValidationError("title must be 1–255 characters", {
        field: "title",
      });
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
      if (
        !Number.isInteger(input.sksWeight) ||
        input.sksWeight < 1 ||
        input.sksWeight > 5
      ) {
        throw new ValidationError("sksWeight must be an integer 1–5", {
          field: "sksWeight",
        });
      }
    }
    if (
      !(input.deadlineAt instanceof Date) ||
      Number.isNaN(input.deadlineAt.getTime())
    ) {
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
            "User must be a member of the classroom to create a task in it",
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
    now: Date = new Date(),
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

    // Batch query unread TaskEditLog entries for all returned tasks to avoid N+1 queries (Task 13.2, Req 9.7)
    const taskIds = rows.map((r) => r.taskId);
    const unreadLogs =
      taskIds.length > 0
        ? await baseDb.taskEditLog.findMany({
            where: {
              taskId: { in: taskIds },
              editorId: { not: userId },
              readStates: {
                none: {
                  userId,
                  isRead: true,
                },
              },
            },
            select: {
              taskId: true,
            },
          })
        : [];

    const unreadCounts = new Map<string, number>();
    for (const log of unreadLogs) {
      unreadCounts.set(log.taskId, (unreadCounts.get(log.taskId) || 0) + 1);
    }

    const nowMs = now.getTime();

    // Decorate each row with a JIT priority score. Tasks past their deadline
    // get urgency 10000 (SLA breach) but are still returned.
    const decorated: QueueTask[] = [];
    for (const row of rows) {
      const t = row.task;
      const hoursRemaining =
        (t.deadlineAt.getTime() - nowMs) / (1000 * 60 * 60);
      const timeUrgency =
        PriorityEngineService.calculateTimeUrgency(hoursRemaining);

      const sksComponent = Math.floor(t.sksWeight * 2000 * 0.4);
      const taskComponent = Math.floor(t.taskWeight * 0.4);
      const timeComponent = Math.floor(timeUrgency * 0.2);
      const priorityScore = Math.min(
        10000,
        Math.max(0, sksComponent + taskComponent + timeComponent),
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
        unreadLogsCount: unreadCounts.get(t.id) || 0,
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
   * Fetch unread notifications (TaskEditLog entries) for a specific user (Task 13.3).
   */
  static async getUnreadNotifications(userId: string): Promise<
    {
      id: string;
      taskId: string;
      taskTitle: string;
      editorName: string;
      editedAt: Date;
    }[]
  > {
    const userProgress = await baseDb.userTaskProgress.findMany({
      where: { userId },
      select: { taskId: true },
    });
    const taskIds = userProgress.map((p) => p.taskId);
    if (taskIds.length === 0) return [];

    const unreadLogs = await baseDb.taskEditLog.findMany({
      where: {
        taskId: { in: taskIds },
        editorId: { not: userId },
        readStates: {
          none: {
            userId,
            isRead: true,
          },
        },
      },
      orderBy: { editedAt: "desc" },
      include: {
        task: { select: { title: true } },
        editor: { select: { name: true } },
      },
    });

    return unreadLogs.map((log) => ({
      id: log.id,
      taskId: log.taskId,
      taskTitle: log.task.title,
      editorName: log.editor.name ?? "Unknown",
      editedAt: log.editedAt,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Fetch the full audit-trail timeline for a Task, newest first.
   *
   * Access is restricted to Users who have a UserTaskProgress bridge row for
   * the Task (i.e. classroom members the Task was propagated to, or the sole
   * owner of a personal Task) — anyone who can see the Task in their queue
   * can see its history (Requirement 9.6), not just the creator.
   *
   * Requirements: 9.4, 9.6
   */
  static async getTaskEditHistory(
    taskId: string,
    userId: string,
  ): Promise<TaskEditHistoryEntry[]> {
    const progress = await baseDb.userTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (!progress) {
      throw new AuthorizationError(
        "You don't have access to this task's history",
      );
    }

    const logs = await baseDb.taskEditLog.findMany({
      where: { taskId },
      orderBy: { editedAt: "desc" },
      include: { editor: { select: { name: true } } },
    });

    // Mark logs as read for current user (Task 13.2, Req 9.9)
    if (logs.length > 0) {
      const unreadLogs = logs.filter((log) => log.editorId !== userId);
      if (unreadLogs.length > 0) {
        await baseDb.taskEditLogRead.createMany({
          data: unreadLogs.map((log) => ({
            logId: log.id,
            userId,
            isRead: true,
          })),
          skipDuplicates: true,
        });
      }
    }

    return logs.map((log) => ({
      id: log.id,
      fieldName: log.fieldName,
      oldValue: log.oldValue,
      newValue: log.newValue,
      editedAt: log.editedAt,
      editorId: log.editorId,
      editorName: log.editor.name ?? "Unknown",
    }));
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
    updates: UpdateTaskInput,
  ): Promise<Task> {
    await this.propagateTaskUpdates(taskId, updates, userId);
    return baseDb.task.findUniqueOrThrow({ where: { id: taskId } });
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Propagate task updates to all classroom members
   * Used when task creator edits a shared task
   * Creates TaskEditLog entries for audit trail
   */
  static async propagateTaskUpdates(
    sourceTaskId: string,
    updates: Partial<Task>,
    editorId: string,
  ): Promise<number> {
    const task = await baseDb.task.findUnique({ where: { id: sourceTaskId } });
    if (!task) throw new NotFoundError("Task", sourceTaskId);

    // Requirement 9.10 — only the creator can edit.
    if (task.creatorId !== editorId) {
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
        newValue: string | number | Date | null,
      ) => {
        const oldStr =
          oldValue instanceof Date ? oldValue.toISOString() : String(oldValue);
        const newStr =
          newValue instanceof Date ? newValue.toISOString() : String(newValue);
        if (oldStr !== newStr) {
          editLogs.push({
            taskId: sourceTaskId,
            editorId,
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

      if (Object.keys(data).length > 0) {
        await tx.task.update({ where: { id: sourceTaskId }, data });
      }

      if (editLogs.length > 0) {
        await tx.taskEditLog.createMany({ data: editLogs });
      }

      // Send in-app notification to all ClassRoom members (except the editor) via UserTaskProgress / ClassRoomMember
      if (task.classRoomId) {
        const members = await tx.classRoomMember.findMany({
          where: {
            classRoomId: task.classRoomId,
            userId: { not: editorId },
          },
          include: {
            user: true,
          },
        });

        const creator = await tx.user.findUnique({
          where: { id: task.creatorId },
          select: { name: true },
        });
        const creatorName = creator?.name || "Unknown";

        for (const member of members) {
          console.log(
            `[Notification] User ${member.userId} notified: "Task ${task.title} diupdate oleh ${creatorName}"`,
          );
        }
      }

      return 1;
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
    userId: string,
  ): Promise<CompleteTaskResult> {
    // Idempotency: if already completed, short-circuit with no celebration.
    const existing = await baseDb.userTaskProgress.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (!existing) {
      throw new NotFoundError("UserTaskProgress", `${userId}/${taskId}`);
    }
    if (existing.status === "COMPLETED") {
      const completedTask = await baseDb.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      // Compute current tiers for a stable return shape.
      const idempotentQueue = await this.getUserTasks(
        userId,
        ["PENDING", "IN_PROGRESS"],
        new Date(),
      );
      const currentScore = this.sumParentScores(idempotentQueue);
      const currentTier = determineCookedTier(currentScore);
      return {
        task: completedTask,
        triggerCelebration: false,
        stressDrop: 0,
        oldTier: currentTier,
        newTier: currentTier,
        celebrationContext: null,
      };
    }

    // Snapshot the cumulative stress score BEFORE completion (Requirement 12.5).
    const beforeQueue = await this.getUserTasks(
      userId,
      ["PENDING", "IN_PROGRESS"],
      new Date(),
    );
    const beforeScore = this.sumParentScores(beforeQueue);
    const oldTier = determineCookedTier(beforeScore);

    // Flip the bridge row.
    const now = new Date();
    await baseDb.userTaskProgress.update({
      where: { userId_taskId: { userId, taskId } },
      data: { status: "COMPLETED", completedAt: now },
    });

    const task = await baseDb.task.findUniqueOrThrow({ where: { id: taskId } });

    // Invalidate cooked score cache after status change (Task 21.2).
    invalidateCookedScoreCache(userId);

    // Auto-complete parent if all subtasks are done (Requirement 7.9).
    if (task.isSubTask && task.parentTaskId) {
      const { RecoveryModeService } = await import("./recovery-mode.service");
      await RecoveryModeService.checkParentCompletion(
        task.parentTaskId,
        userId,
      );
    }

    // Snapshot the cumulative stress score AFTER completion (Requirement 12.5).
    const afterQueue = await this.getUserTasks(
      userId,
      ["PENDING", "IN_PROGRESS"],
      now,
    );
    const afterScore = this.sumParentScores(afterQueue);
    const newTier = determineCookedTier(afterScore);
    const stressDrop = Math.max(0, beforeScore - afterScore);

    // Celebration fires only when the user was OVERCOOKED before completion
    // (Requirement 12.1).
    const triggerCelebration = oldTier === "OVERCOOKED";

    // Build celebration context for the Academic Comeback modal
    // (Requirements 12.5, 12.6).
    const celebrationContext: CelebrationContext | null = triggerCelebration
      ? {
          oldTier,
          newTier,
          stressDrop,
          completedTaskWeight: task.taskWeight,
        }
      : null;

    return {
      task,
      triggerCelebration,
      stressDrop,
      oldTier,
      newTier,
      celebrationContext,
    };
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
    reason: string,
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
   * Persist a drag-and-drop reorder of the user's PARENT-task queue
   * (Requirements 5.3, 14.2.4, 14.2.5).
   *
   * This is the Task 10.3 entry point: the client applies the reorder
   * optimistically and calls this method with the new ordered list of Parent
   * Task ids so the hybrid sort (`position ASC nulls last → priorityScore DESC
   * → deadline ASC`) reproduces the exact dragged order on the next render.
   *
   * Why sequential positions for *all* parents: with the nulls-last sort,
   * writing a single task's `position` only reproduces the order for moves to
   * the very front. Assigning every parent its array index makes the manual
   * order fully deterministic. (SubTasks are never part of `orderedTaskIds` —
   * they are not draggable, Requirement 14.2.6.)
   *
   * No `TaskOverride` row is created here — the override reason collection
   * (Task 10.5) is a separate, later concern layered on the same drag.
   *
   * @param userId          The authenticated user.
   * @param orderedTaskIds  Parent Task ids in their new queue order. Must be a
   *                        permutation of the user's current active Parent
   *                        Tasks (no missing, no extra ids).
   * @throws {ValidationError} if `orderedTaskIds` is empty or malformed.
   * @throws {NotFoundError}   if any id is not associated with the user.
   */
  static async reorderQueue(
    userId: string,
    orderedTaskIds: string[],
  ): Promise<void> {
    if (
      !Array.isArray(orderedTaskIds) ||
      orderedTaskIds.length === 0 ||
      orderedTaskIds.some((id) => typeof id !== "string" || id.length === 0)
    ) {
      throw new ValidationError(
        "orderedTaskIds must be a non-empty array of task ids",
      );
    }

    // Guard against duplicates — a permutation has no repeats.
    if (new Set(orderedTaskIds).size !== orderedTaskIds.length) {
      throw new ValidationError("orderedTaskIds must not contain duplicates");
    }

    // Verify the user owns a bridge row for every id in the new order.
    const owned = await baseDb.userTaskProgress.findMany({
      where: { userId, taskId: { in: orderedTaskIds } },
      select: { taskId: true },
    });
    const ownedIds = new Set(owned.map((row) => row.taskId));
    const missing = orderedTaskIds.filter((id) => !ownedIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError("UserTaskProgress", `${userId}/${missing[0]}`);
    }

    // Assign sequential positions (0..n-1) in a single transaction so the
    // hybrid sort deterministically reproduces the dragged order.
    await baseDb.$transaction(
      orderedTaskIds.map((taskId, index) =>
        baseDb.userTaskProgress.update({
          where: { userId_taskId: { userId, taskId } },
          data: { position: index },
        }),
      ),
    );
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
