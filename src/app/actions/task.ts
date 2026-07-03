"use server";

/**
 * Task Server Actions.
 *
 * Server Actions for task-related mutations (reorder / override persistence,
 * task completion, etc.). Each action follows the established
 * {@link ActionResult} discriminated-union pattern so client components can
 * branch on `success` for optimistic UI, toasts, and rollback logic.
 *
 * Requirements wired here:
 *  - 5.1 / 5.3 / 5.6 — drag-and-drop position update + TaskOverride record
 *  - 4.9            — task completion with optimistic removal from queue
 *
 * Reference: design.md > Server Action Error Responses, `(auth)/actions.ts`
 */

import { auth } from "@/auth";
import { TaskService } from "@/lib/services/task.service";
import {
  AuthorizationError,
  DomainError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import { OverrideSchema, type ActionResult } from "@/lib/validation/schemas";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import { revalidatePath } from "next/cache";

// ─── HELPERS ────────────────────────────────────────────────────────────────

/** Minimal structural view of a Zod issue (version-agnostic). */
type ZodIssueLike = { path: PropertyKey[]; message: string };

function collectFieldErrors(issues: ZodIssueLike[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

// ─── REORDER / OVERRIDE ACTION ─────────────────────────────────────────────

/** Input for the reorder-task Server Action. */
export interface ReorderTaskInput {
  taskId: string;
  oldPosition: number;
  newPosition: number;
  reason: string;
}

/**
 * Persist a drag-and-drop position change for the current user.
 *
 * Validates the input with {@link OverrideSchema}, then delegates to
 * `TaskService.recordOverride` which atomically:
 *  1. Creates a `TaskOverride` audit row (Requirement 5.6)
 *  2. Updates the `UserTaskProgress.position` field (Requirement 5.3)
 *
 * The client component performs an optimistic UI update *before* calling this
 * action and rolls back on failure (Requirement 14.2.4, 14.2.5).
 *
 * Requirements: 5.1, 5.3, 5.6, 14.2.4, 14.2.5
 */
export async function reorderTaskAction(
  input: ReorderTaskInput,
): Promise<ActionResult<void>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Auth gate.
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }
  const userId = session.user.id;

  // Validate input.
  const parsed = OverrideSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: t("error.validationFailed"),
      fieldErrors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]),
    };
  }

  const { taskId, oldPosition, newPosition, reason } = parsed.data;

  try {
    await TaskService.recordOverride(
      taskId,
      userId,
      oldPosition,
      newPosition,
      reason,
    );
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: t("error.notFound") };
    }
    if (err instanceof AuthorizationError) {
      return { success: false, error: t("error.unauthorized") };
    }
    if (err instanceof ValidationError) {
      return { success: false, error: err.message };
    }
    if (err instanceof DomainError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}

// ─── REORDER ACTION (Task 10.3) ─────────────────────────────────────────────

/** Input for the queue-reorder Server Action. */
export interface ReorderQueueInput {
  /** Parent Task ids in their new queue order. */
  orderedTaskIds: string[];
}

/**
 * Persist a drag-and-drop reorder of the user's PARENT-task queue
 * (Requirements 5.3, 14.2.4, 14.2.5).
 *
 * This is the Task 10.3 Server Action: the client has already applied the
 * reorder optimistically and calls this with the new ordered list of Parent
 * Task ids so the hybrid sort (`position ASC nulls last → priorityScore DESC
 * → deadline ASC`) reproduces the exact dragged order on the next render. It
 * does NOT create a `TaskOverride` record — the override reason collection
 * (Task 10.5) is wired separately atop the same drag interaction.
 *
 * On failure the client rolls back its local state and surfaces a toast
 * (Requirement 14.2.5).
 *
 * Requirements: 5.3, 14.2.4, 14.2.5
 */
export async function reorderQueueAction(
  input: ReorderQueueInput,
): Promise<ActionResult<void>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Auth gate.
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }
  const userId = session.user.id;

  // Basic input guard (non-empty array of non-empty strings).
  if (
    !Array.isArray(input.orderedTaskIds) ||
    input.orderedTaskIds.length === 0 ||
    input.orderedTaskIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return { success: false, error: t("error.validationFailed") };
  }

  try {
    await TaskService.reorderQueue(userId, input.orderedTaskIds);
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: t("error.notFound") };
    }
    if (err instanceof AuthorizationError) {
      return { success: false, error: t("error.unauthorized") };
    }
    if (err instanceof ValidationError) {
      return { success: false, error: err.message };
    }
    if (err instanceof DomainError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}

/**
 * Mark a task as completed for the current user.
 * Delegates to TaskService.completeTask.
 *
 * Requirements: 4.9, 12.1
 */
export async function completeTaskAction(
  taskId: string,
): Promise<
  ActionResult<import("@/lib/services/task.service").CompleteTaskResult>
> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Auth gate.
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }
  const userId = session.user.id;

  if (typeof taskId !== "string" || taskId.length === 0) {
    return { success: false, error: t("error.validationFailed") };
  }

  try {
    const result = await TaskService.completeTask(taskId, userId);
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: t("error.notFound") };
    }
    if (err instanceof AuthorizationError) {
      return { success: false, error: t("error.unauthorized") };
    }
    if (err instanceof ValidationError) {
      return { success: false, error: err.message };
    }
    if (err instanceof DomainError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}

// ─── TASK EDIT HISTORY ACTION (Task 13.1) ──────────────────────────────────

/**
 * Fetch the audit-trail timeline (TaskEditLog entries) for a Task.
 *
 * Access is gated to Users with a UserTaskProgress bridge row for the Task
 * (delegated to `TaskService.getTaskEditHistory`), so any classroom member
 * the Task was propagated to — not just the creator — can view it.
 *
 * Requirements: 9.4, 9.6
 */
export async function getTaskEditHistoryAction(
  taskId: string,
): Promise<
  ActionResult<import("@/lib/services/task.service").TaskEditHistoryEntry[]>
> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }

  if (typeof taskId !== "string" || taskId.length === 0) {
    return { success: false, error: t("error.validationFailed") };
  }

  try {
    const history = await TaskService.getTaskEditHistory(
      taskId,
      session.user.id,
    );
    return { success: true, data: history };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: t("error.notFound") };
    }
    if (err instanceof AuthorizationError) {
      return { success: false, error: t("error.forbidden") };
    }
    if (err instanceof ValidationError) {
      return { success: false, error: err.message };
    }
    if (err instanceof DomainError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}

/** Input for the createTask Server Action. */
export interface CreateTaskActionInput {
  title: string;
  description?: string;
  sksWeight?: number;
  taskWeight: number; // basis points
  deadlineAt: string; // ISO datetime string
  classRoomId?: string;
}

/**
 * Server Action to create a new task.
 *
 * Validates inputs via Zod `createTaskSchema` and delegates to TaskService.createTask.
 *
 * Requirements: 8.6, 8.7, 8.8
 */
export async function createTaskAction(
  input: CreateTaskActionInput,
): Promise<
  ActionResult<{ id: string; title: string; classRoomId: string | null }>
> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Auth gate.
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }
  const userId = session.user.id;

  // Validate inputs.
  const { createTaskSchema } = await import("@/lib/validation/schemas");
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: t("error.validationFailed") || "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]),
    };
  }

  try {
    const task = await TaskService.createTask(userId, {
      title: parsed.data.title,
      description: parsed.data.description,
      sksWeight: parsed.data.sksWeight,
      taskWeight: parsed.data.taskWeight,
      deadlineAt: new Date(parsed.data.deadlineAt),
      classRoomId: parsed.data.classRoomId,
    });

    revalidatePath("/dashboard");
    revalidatePath("/classrooms");

    return {
      success: true,
      data: {
        id: task.id,
        title: task.title,
        classRoomId: task.classRoomId,
      },
    };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { success: false, error: t("error.notFound") };
    }
    if (err instanceof AuthorizationError) {
      return { success: false, error: t("error.unauthorized") };
    }
    if (err instanceof ValidationError) {
      const field = err.details?.field;
      return {
        success: false,
        error: err.message,
        fieldErrors:
          typeof field === "string" ? { [field]: [err.message] } : undefined,
      };
    }
    if (err instanceof DomainError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}
