"use server";

import { auth } from "@/auth";
import { RecoveryModeService } from "@/lib/services/recovery-mode.service";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import type { ActionResult } from "@/lib/validation/schemas";

export interface RecoveryCandidateView {
  id: string;
  title: string;
  taskWeight: number;
  sksWeight: number;
}

/** Serializable view of a single created SubTask. */
export interface SubTaskView {
  id: string;
  title: string;
  taskWeight: number;
  deadlineAt: string; // ISO string for serialization across server/client boundary
}

/** Serializable view of a parent task breakdown result. */
export interface TaskBreakdownView {
  parentTaskId: string;
  parentTaskTitle: string;
  subTasks: SubTaskView[];
}

/** Full result returned by {@link activateRecoveryModeAction}. */
export interface ActivateRecoveryResult {
  motivationalText: string;
  activatedAt: string; // ISO string
  tasksBreakdown: TaskBreakdownView[];
}

/**
 * Fetch top 3 candidate Parent Tasks for breakdown (taskWeight > 3000 basis points).
 *
 * Requirements: 7.5
 */
export async function getRecoveryCandidatesAction(): Promise<ActionResult<RecoveryCandidateView[]>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }

  try {
    const tasks = await RecoveryModeService.getCandidateTasksForRecovery(session.user.id);
    const mapped: RecoveryCandidateView[] = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      taskWeight: task.taskWeight,
      sksWeight: task.sksWeight,
    }));
    return { success: true, data: mapped };
  } catch {
    return { success: false, error: t("error.generic") };
  }
}

interface ActivateRecoveryInput {
  taskIdsToBreakdown: string[];
}

/**
 * Activate Recovery Mode with explicit user consent on selected tasks.
 *
 * Delegates to {@link RecoveryModeService.activateRecoveryMode} which:
 *  1. Validates each taskId exists and has a UserTaskProgress row for the user.
 *  2. Creates 3–5 SubTask records per parent with staggered deadlines (Req 7.6).
 *  3. Stores SubTasks with `parentTaskId` and `isSubTask=true` (Req 7.7).
 *
 * Returns the full breakdown results (parent + created subtasks) and a
 * motivational text string (Req 7.9).
 *
 * Requirements: 7.2, 7.3, 7.6, 7.7, 7.9
 */
export async function activateRecoveryModeAction(
  input: ActivateRecoveryInput
): Promise<ActionResult<ActivateRecoveryResult>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }

  const { taskIdsToBreakdown } = input;
  if (!Array.isArray(taskIdsToBreakdown) || taskIdsToBreakdown.length === 0) {
    return { success: false, error: t("error.validationFailed") };
  }

  try {
    const result = await RecoveryModeService.activateRecoveryMode(
      session.user.id,
      taskIdsToBreakdown
    );

    // Map to serializable views (Dates → ISO strings for the server/client boundary).
    const tasksBreakdown: TaskBreakdownView[] = result.tasksBreakdown.map((entry) => ({
      parentTaskId: entry.parentTask.id,
      parentTaskTitle: entry.parentTask.title,
      subTasks: entry.subTasks.map((st) => ({
        id: st.id,
        title: st.title,
        taskWeight: st.taskWeight,
        deadlineAt: st.deadlineAt.toISOString(),
      })),
    }));

    return {
      success: true,
      data: {
        motivationalText: result.motivationalText,
        activatedAt: result.activatedAt.toISOString(),
        tasksBreakdown,
      },
    };
  } catch (err) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}

