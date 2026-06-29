import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { TaskService } from "@/lib/services/task.service";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

import { TaskQueueClient } from "./components/TaskQueueClient";

/**
 * Dashboard page — Server Component.
 *
 * Fetches the user's Task Queue server-side via `TaskService.getUserTasks`,
 * which applies Just-In-Time priority calculation and the hybrid sort
 * (position ASC nulls last → priorityScore DESC → deadlineAt ASC) per
 * Requirements 4.2, 4.3, 4.7. The resulting queue is handed to
 * `TaskQueueClient` as `initialTasks` for initial render (Requirement 4.1).
 *
 * Active tasks only (PENDING + IN_PROGRESS); completed tasks are excluded so
 * they disappear from the queue without a full page refresh once the
 * completion flow (Task 10.6) wires the optimistic update (Requirement 4.9).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.7, 4.10
 */
export default async function DashboardPage() {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authorization gate — middleware also enforces this; the guard here keeps
  // the deep-link path consistent and guarantees `session.user.id`.
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  // JIT evaluation + hybrid sort (Requirements 4.2, 4.3, 4.7).
  const initialTasks = await TaskService.getUserTasks(userId);

  return (
    <TaskQueueClient
      initialTasks={initialTasks}
      labels={{
        title: t("queue.title"),
        statusPending: t("task.status.PENDING"),
        statusInProgress: t("task.status.IN_PROGRESS"),
        statusCompleted: t("task.status.COMPLETED"),
        deadlineLabel: t("task.card.deadline"),
        overrideBadge: t("task.card.overrideBadge"),
        sharedFromClass: t("task.card.sharedFromClass"),
        subtasksLabel: t("task.card.subtasks"),
        slaBreach: t("task.card.slaBreach"),
        emptyTitle: t("queue.empty.title"),
        emptyMessage: t("queue.empty.message"),
        emptyCta: t("queue.empty.cta"),
        dragHandle: t("queue.dragHandle"),
        reorderFailed: t("queue.reorderFailed"),
        locale,
        microPromptTemplate: t("task.microPrompt.template"),
      }}
    />
  );
}
