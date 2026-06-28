"use client";

/**
 * TaskQueueClient — Client Component leaf that renders the initial Task Queue.
 *
 * Receives the already-sorted, JIT-scored queue from the Server Component
 * (src/app/dashboard/page.tsx owns the data fetch + hybrid sort per
 * Requirements 4.1–4.3, 4.7). This component is purely presentational on the
 * server round-trip: it renders the queue and groups Parent Tasks with their
 * nested SubTasks (Requirement 14.2.6 — micro-tasks render nested inside the
 * parent card, never as standalone cards).
 *
 * NOTE: drag-and-drop (Task 10.3), override modal (10.5), and completion flow
 * (10.6) are deliberately NOT implemented here — they belong to later tasks and
 * would require optimistic UI + Server Action wiring. This task (10.1/10.2)
 * owns only the initial-render surface and empty state (Requirement 4.10).
 *
 * All visible strings are pre-resolved server-side and passed in via `labels`,
 * so this client component never needs to know the active locale (Requirement
 * 2.5).
 *
 * Requirements: 4.1, 4.4, 4.5, 4.6, 4.8, 4.10, 5.10, 8.9, 14.2.6
 */

import type { QueueTask } from "@/lib/services/task.service";

// ─── Labels (pre-localized server-side) ─────────────────────────────────────

export interface TaskQueueLabels {
  /** Section title for the queue widget. */
  title: string;
  /** Status badge labels. */
  statusPending: string;
  statusInProgress: string;
  statusCompleted: string;
  /** Deadline prefix. */
  deadlineLabel: string;
  /** Override / shared indicators. */
  overrideBadge: string;
  sharedFromClass: string;
  subtasksLabel: string;
  /** SLA breach badge (Requirement 4.6). */
  slaBreach: string;
  /** Empty state (Requirement 4.10). */
  emptyTitle: string;
  emptyMessage: string;
  emptyCta: string;
  /** Relative time helper, pre-applied per-task by the Server Component. */
  locale: "EN" | "ID";
}

interface TaskQueueClientProps {
  /** Initial queue, already sorted by the Server Component (Req 4.2, 4.3). */
  initialTasks: QueueTask[];
  labels: TaskQueueLabels;
}

export function TaskQueueClient({
  initialTasks,
  labels,
}: TaskQueueClientProps): React.ReactNode {
  // Empty state with illustration + motivational copy (Requirement 4.10).
  if (initialTasks.length === 0) {
    return <EmptyState labels={labels} />;
  }

  // Split into Parent Tasks (rendered as cards) and SubTasks (nested).
  // A Parent Task may have a non-null parentTaskId only if it is itself a
  // SubTask (isSubTask=true); we group SubTasks under their parent.
  const parents = initialTasks.filter((t) => !t.task.isSubTask);
  const subtasksByParent = new Map<string, QueueTask[]>();
  for (const t of initialTasks) {
    if (t.task.isSubTask && t.task.parentTaskId) {
      const list = subtasksByParent.get(t.task.parentTaskId);
      if (list) {
        list.push(t);
      } else {
        subtasksByParent.set(t.task.parentTaskId, [t]);
      }
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {labels.title}
        </h2>
        <span
          className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          aria-label={`${parents.length} ${labels.title}`}
        >
          {parents.length}
        </span>
      </header>

      <ol className="flex flex-col gap-3" role="list">
        {parents.map((task) => {
          const nested = subtasksByParent.get(task.task.id) ?? [];
          return (
            <TaskCard
              key={task.task.id}
              task={task}
              nested={nested}
              labels={labels}
            />
          );
        })}
      </ol>
    </div>
  );
}

// ─── Task card ──────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: QueueTask;
  nested: QueueTask[];
  labels: TaskQueueLabels;
}

function TaskCard({ task, nested, labels }: TaskCardProps): React.ReactNode {
  const isSlaBreach = task.timeUrgency >= 10000; // max urgency bucket
  const statusLabel = statusToLabel(task.progress.status, labels);

  return (
    <li
      role="listitem"
      className="rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
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
              task.progress.status === "COMPLETED" ? "line-through opacity-60" : ""
            }`}
          >
            {task.task.title}
          </h3>

          {/* Micro-prompt (Requirement 4.5). */}
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {task.microPrompt}
          </p>

          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="text-zinc-400 dark:text-zinc-500">
              {labels.deadlineLabel}:{" "}
            </span>
            <time
              dateTime={task.task.deadlineAt.toISOString()}
              className={
                isSlaBreach
                  ? "font-semibold text-sla"
                  : "font-medium text-zinc-600 dark:text-zinc-300"
              }
            >
              {formatDeadline(task.task.deadlineAt, labels.locale)}
            </time>
          </p>
        </div>

        {/* Priority score — the queue's reason to exist; show it quietly. */}
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {task.priorityScore.toLocaleString()}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            score
          </div>
        </div>
      </div>

      {/* Nested SubTasks (Requirement 14.2.6). */}
      {nested.length > 0 ? (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {labels.subtasksLabel}
          </p>
          <ul className="flex flex-col gap-2" role="list">
            {nested.map((sub) => (
              <SubTaskRow key={sub.task.id} task={sub} labels={labels} />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

// ─── Sub-task row (nested) ─────────────────────────────────────────────────

interface SubTaskRowProps {
  task: QueueTask;
  labels: TaskQueueLabels;
}

function SubTaskRow({ task, labels }: SubTaskRowProps): React.ReactNode {
  const statusLabel = statusToLabel(task.progress.status, labels);
  const isSlaBreach = task.timeUrgency >= 10000;
  return (
    <li
      role="listitem"
      className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50"
    >
      <StatusDot status={task.progress.status} />
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
            ? "font-semibold text-sla"
            : "text-zinc-400 dark:text-zinc-500"
        }`}
      >
        {formatDeadline(task.task.deadlineAt, labels.locale)}
      </time>
    </li>
  );
}

// ─── Status primitives ──────────────────────────────────────────────────────

function StatusBadge({
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

function StatusDot({
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
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} aria-hidden="true" />;
}

function statusToLabel(
  status: QueueTask["progress"]["status"],
  labels: TaskQueueLabels,
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

// ─── Date formatting (locale-aware, Requirement 2.9) ────────────────────────

function formatDeadline(date: Date, locale: "EN" | "ID"): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const datePart =
    locale === "ID" ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  return `${datePart} ${hh}:${mm}`;
}

// ─── Empty state (Requirement 4.10) ─────────────────────────────────────────

function EmptyState({ labels }: { labels: TaskQueueLabels }): React.ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/60 p-8 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
      {/* Inline SVG illustration — a calm "all clear" checkmark, not a generic
          SaaS empty-state illustration. */}
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        role="img"
        aria-hidden="true"
        className="mb-4 text-emerald-500"
      >
        <circle
          cx="32"
          cy="32"
          r="29"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="4 4"
          opacity="0.4"
        />
        <circle cx="32" cy="32" r="20" fill="currentColor" opacity="0.12" />
        <path
          d="M23 32.5l6 6 12-12"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {labels.emptyTitle}
      </h3>
      <p className="mt-1 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
        {labels.emptyMessage}
      </p>
      {/* CTA is presentational; wiring the create-task flow is Task 10.6+ scope. */}
      <span className="mt-4 inline-flex h-9 items-center rounded-full bg-zinc-900 px-4 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
        {labels.emptyCta}
      </span>
    </div>
  );
}
