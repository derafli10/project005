import { auth } from "@/auth";
import { redirect } from "next/navigation";

import { TaskService } from "@/lib/services/task.service";
import { classRoomService } from "@/lib/services/classroom.service";
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
 * Also fetches the user's classroom memberships so the task creation form
 * can offer a "Share to Class" dropdown (Requirements 8.6, 8.7, 8.8).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.7, 4.10, 8.6, 8.7, 8.8
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

  // Fetch classroom memberships for the "Share to Class" dropdown (Requirements 8.6, 8.7).
  const memberships = await classRoomService.getUserClassRooms(userId);
  const classrooms = memberships.map((m) => ({
    id: m.classRoom.id,
    className: m.classRoom.className,
    sksWeight: m.classRoom.sksWeight,
  }));

  return (
    <TaskQueueClient
      initialTasks={initialTasks}
      classrooms={classrooms}
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
        updatesBadge: t("task.card.updatesBadge"),
        emptyTitle: t("queue.empty.title"),
        emptyMessage: t("queue.empty.message"),
        emptyCta: t("queue.empty.cta"),
        dragHandle: t("queue.dragHandle"),
        reorderFailed: t("queue.reorderFailed"),
        locale,
        microPromptTemplate: t("task.microPrompt.template"),
        overrideTitle: t("override.modal.title"),
        question: t("override.modal.question"),
        subtitle: t("override.modal.subtitle"),
        optionMoreUrgent: t("override.option.more_urgent"),
        optionNeedTeam: t("override.option.need_team"),
        optionHarder: t("override.option.harder"),
        optionPersonal: t("override.option.personal"),
        personalPlaceholder: t("override.modal.personalPlaceholder"),
        submit: t("override.modal.submit"),
        cancel: t("common.cancel"),
        createTask: t("task.create"),
        editHistoryLabels: {
          viewHistory: t("task.card.viewHistory"),
          title: t("history.title"),
          fieldLabels: {
            deadlineAt: t("history.field.deadlineAt"),
            taskWeight: t("history.field.taskWeight"),
            title: t("history.field.title"),
            description: t("history.field.description"),
            sksWeight: t("history.field.sksWeight"),
          },
          updatedByTemplate: t("history.updatedBy"),
          loading: t("common.loading"),
          empty: t("history.empty"),
          errorGeneric: t("error.generic"),
          locale,
        },
        createTaskFormLabels: {
          title: t("task.create.title"),
          titleLabel: t("task.create.titleLabel"),
          titlePlaceholder: t("task.create.titlePlaceholder"),
          descriptionLabel: t("task.create.descriptionLabel"),
          descriptionPlaceholder: t("task.create.descriptionPlaceholder"),
          taskWeightLabel: t("task.create.taskWeightLabel"),
          taskWeightHint: t("task.create.taskWeightHint"),
          sksWeightLabel: t("task.create.sksWeightLabel"),
          deadlineLabel: t("task.create.deadlineLabel"),
          classRoomLabel: t("task.create.classRoomLabel"),
          classRoomNone: t("task.create.classRoomNone"),
          submit: t("task.create.submit"),
          success: t("task.create.success"),
          cancel: t("common.cancel"),
        },
      }}
    />
  );
}
