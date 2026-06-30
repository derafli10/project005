"use server";

import { auth } from "@/auth";
import { RecoveryModeService } from "@/lib/services/recovery-mode.service";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
import type { ActionResult } from "@/lib/validation/schemas";
import type { Task } from "@/generated/prisma";

export interface RecoveryCandidateView {
  id: string;
  title: string;
  taskWeight: number;
  sksWeight: number;
}

/**
 * Fetch top 3 candidate Parent Tasks for breakdown (taskWeight > 3000 basis points).
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
    const mapped = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      taskWeight: t.taskWeight,
      sksWeight: t.sksWeight,
    }));
    return { success: true, data: mapped };
  } catch (err) {
    return { success: false, error: t("error.generic") };
  }
}

interface ActivateRecoveryInput {
  taskIdsToBreakdown: string[];
}

/**
 * Activate Recovery Mode with explicit user consent on selected tasks.
 */
export async function activateRecoveryModeAction(
  input: ActivateRecoveryInput
): Promise<
  ActionResult<{
    motivationalText: string;
  }>
> {
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
    return {
      success: true,
      data: {
        motivationalText: result.motivationalText,
      },
    };
  } catch (err) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}
