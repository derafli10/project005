"use client";

import React from "react";
import { GripVertical } from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import type { QueueTask } from "@/lib/services/task.service";
import { TaskEditHistory, type TaskEditHistoryLabels } from "./TaskEditHistory";

// ─── Status primitives ──────────────────────────────────────────────────────

export function StatusBadge({
  status,
  label,
}: {
  status: QueueTask["progress"]["status"];
  label: string;
}): React.ReactNode {
  const cls =
    status === "COMPLETED"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "IN_PROGRESS"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

export function StatusDot({
  status,
}: {
  status: QueueTask["progress"]["status"];
}): React.ReactNode {
  const cls =
    status === "COMPLETED"
      ? "bg-emerald-500"
      : status === "IN_PROGRESS"
        ? "bg-sky-500"
        : "bg-zinc-300 dark:bg-zinc-600";
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`}
      aria-hidden="true"
    />
  );
}

export function statusToLabel(
  status: QueueTask["progress"]["status"],
  labels: {
    statusPending: string;
    statusInProgress: string;
    statusCompleted: string;
  },
): string {
  switch (status) {
    case "COMPLETED":
      return labels.statusCompleted;
    case "IN_PROGRESS":
      return labels.statusInProgress;
    case "PENDING":
    default:
      return labels.statusPending;
  }
}

// ─── Date formatting (locale-aware) ────────────────────────────────────────

export function formatDeadline(date: Date, locale: "EN" | "ID"): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const datePart =
    locale === "ID" ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  return `${datePart} ${hh}:${mm}`;
}

// ─── Sub-task row (nested) ─────────────────────────────────────────────────

interface SubTaskRowProps {
  task: QueueTask;
  labels: {
    locale: "EN" | "ID";
  };
  onComplete?: (taskId: string) => void;
}

export function SubTaskRow({
  task,
  labels,
  onComplete,
}: SubTaskRowProps): React.ReactNode {
  const isSlaBreach = task.timeUrgency >= 10000;
  return (
    <li
      role="listitem"
      className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50"
    >
      {task.progress.status !== "COMPLETED" && onComplete ? (
        <button
          type="button"
          onClick={() => onComplete(task.task.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-zinc-400 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 transition-all dark:border-zinc-700 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/30"
          title="Complete"
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </button>
      ) : (
        <StatusDot status={task.progress.status} />
      )}
      <span
        className={`min-w-0 flex-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300 ${
          task.progress.status === "COMPLETED" ? "line-through opacity-60" : ""
        }`}
        title={task.task.title}
      >
        {task.task.title}
      </span>
      <time
        dateTime={task.task.deadlineAt.toISOString()}
        className={`shrink-0 text-[11px] tabular-nums ${
          isSlaBreach
            ? "font-semibold text-red-600 dark:text-red-400"
            : "text-zinc-400 dark:text-zinc-500"
        }`}
      >
        {formatDeadline(task.task.deadlineAt, labels.locale)}
      </time>
    </li>
  );
}

// ─── Main TaskCard ─────────────────────────────────────────────────────────

export interface TaskCardLabels {
  statusPending: string;
  statusInProgress: string;
  statusCompleted: string;
  deadlineLabel: string;
  overrideBadge: string;
  sharedFromClass: string;
  subtasksLabel: string;
  slaBreach: string;
  dragHandle?: string;
  locale: "EN" | "ID";
  microPromptTemplate?: string;
  completeLabel?: string;
  /** Labels for the collapsible Task Edit History timeline (Requirement 9.6). */
  editHistoryLabels?: TaskEditHistoryLabels;
}

export interface TaskCardProps {
  task: QueueTask;
  nested: QueueTask[];
  labels: TaskCardLabels;
  dragging?: boolean;
  dragHandleProps?: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
  };
  dragHandleLabel?: string;
  onComplete?: (taskId: string) => void;
}

export function TaskCard({
  task,
  nested,
  labels,
  dragging = false,
  dragHandleProps,
  dragHandleLabel,
  onComplete,
}: TaskCardProps): React.ReactNode {
  const isSlaBreach = task.timeUrgency >= 10000; // max urgency bucket
  const statusLabel = statusToLabel(task.progress.status, labels);

  // Compute localized micro-prompt using the template if available
  const microPrompt = React.useMemo(() => {
    if (labels.microPromptTemplate) {
      const hoursRemaining =
        (task.task.deadlineAt.getTime() - Date.now()) / (1000 * 60 * 60);
      const daysRemaining = Math.max(0, Math.ceil(hoursRemaining / 24));
      const weightPercent = Math.round((task.task.taskWeight / 10000) * 100);

      let text = labels.microPromptTemplate
        .replace("{sks}", String(task.task.sksWeight))
        .replace("{weight}", String(weightPercent))
        .replace("{days}", String(daysRemaining));

      if (hoursRemaining < 24) {
        text += ` • ${labels.slaBreach}`;
      }
      return text;
    }
    return task.microPrompt;
  }, [task, labels]);

  return (
    <div
      className={
        dragging
          ? "flex flex-col gap-3 rounded-xl bg-white shadow-2xl ring-2 ring-zinc-900/10 dark:bg-zinc-900"
          : "flex flex-col gap-3"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.progress.status} label={statusLabel} />

            {/* Manual override indicator (Requirement 5.10). */}
            {task.progress.position !== null ? (
              <span
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                title={labels.overrideBadge}
              >
                {labels.overrideBadge}
              </span>
            ) : null}

            {/* Shared from Class indicator (Requirement 8.9). */}
            {task.task.classRoomId ? (
              <span
                className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                title={labels.sharedFromClass}
              >
                {labels.sharedFromClass}
              </span>
            ) : null}

            {/* SLA breach badge (Requirement 4.6). */}
            {isSlaBreach ? (
              <span
                className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300"
                title={labels.slaBreach}
              >
                {labels.slaBreach}
              </span>
            ) : null}
          </div>

          <h3
            className={`mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50 ${
              task.progress.status === "COMPLETED"
                ? "line-through opacity-60"
                : ""
            }`}
          >
            {task.task.title}
          </h3>

          {/* Description (Requirement 10.4). */}
          {task.task.description ? (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              {task.task.description}
            </p>
          ) : null}

          {/* Micro-prompt (Requirement 4.5). */}
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {microPrompt}
          </p>

          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="text-zinc-400 dark:text-zinc-500">
              {labels.deadlineLabel}:{" "}
            </span>
            <time
              dateTime={task.task.deadlineAt.toISOString()}
              className={
                isSlaBreach
                  ? "font-semibold text-red-600 dark:text-red-400"
                  : "font-medium text-zinc-600 dark:text-zinc-300"
              }
            >
              {formatDeadline(task.task.deadlineAt, labels.locale)}
            </time>
          </p>
        </div>

        {/* Right rail: priority score + drag handle (parent cards only). */}
        <div className="flex shrink-0 items-start gap-1.5">
          {/* Complete action button */}
          {task.progress.status !== "COMPLETED" && onComplete && (
            <button
              type="button"
              onClick={() => onComplete(task.task.id)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-400 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 transition-all dark:border-zinc-800 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/30"
              title={labels.completeLabel || "Complete"}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
          )}

          {/* Priority score */}
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {task.priorityScore.toLocaleString()}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              score
            </div>
          </div>

          {/* Drag handle — Requirement 5.1. Only parent cards receive it. */}
          {dragHandleProps ? (
            <button
              type="button"
              aria-label={dragHandleLabel}
              className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              {...dragHandleProps.attributes}
              {...dragHandleProps.listeners}
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Nested SubTasks (Requirement 14.2.6). */}
      {nested.length > 0 ? (
        <div className="mt-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {labels.subtasksLabel}
          </p>
          <ul className="flex flex-col gap-2" role="list">
            {nested.map((sub) => (
              <SubTaskRow
                key={sub.task.id}
                task={sub}
                labels={labels}
                onComplete={onComplete}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Task Edit History timeline (Requirements 9.4, 9.5, 9.6). */}
      {labels.editHistoryLabels ? (
        <TaskEditHistory
          taskId={task.task.id}
          labels={labels.editHistoryLabels}
        />
      ) : null}
    </div>
  );
}
