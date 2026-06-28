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
import {
  OverrideSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

// ─── HELPERS ────────────────────────────────────────────────────────────────

/** Minimal structural view of a Zod issue (version-agnostic). */
type ZodIssueLike = { path: PropertyKey[]; message: string };

function collectFieldErrors(
  issues: ZodIssueLike[],
): Record<string, string[]> {
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
