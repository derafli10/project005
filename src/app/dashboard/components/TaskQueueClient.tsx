"use client";

/**
 * TaskQueueClient — Client Component that renders the Task Queue with
 * drag-and-drop reordering.
 *
 * Receives the already-sorted, JIT-scored queue from the Server Component
 * (src/app/dashboard/page.tsx owns the data fetch + hybrid sort per
 * Requirements 4.1–4.3, 4.7) and renders it as a vertical, reorderable list
 * of Parent Task cards, grouping SubTasks nested inside their parent
 * (Requirement 14.2.6 — micro-tasks render nested inside the parent card,
 * never as standalone cards).
 *
 * Drag-and-drop (Task 10.3):
 *  - `@dnd-kit/core` + `@dnd-kit/sortable` power the reorder; only PARENT
 *    tasks are draggable (SubTask rows are static — Requirement 14.2.6).
 *  - While dragging, the dragged card shows elevated-shadow visual feedback
 *    and the remaining cards animate into place via Framer Motion
 *    `LayoutGroup` (Requirements 5.2, 14.2).
 *  - On drop, the new order is applied OPTIMISTICALLY (local state updates
 *    instantly) and the `reorderQueueAction` Server Action persists the
 *    positions (Requirements 14.2.4, 5.3). If the action fails, the local
 *    state is rolled back and a toast surfaces the error (Requirement 14.2.5).
 *  - Micro-animations are capped under 300ms (Requirement 14.4.11).
 *
 * The override feedback bottom-sheet (Task 10.5) and task completion flow
 * (Task 10.6) are deliberately NOT implemented here — they belong to later
 * tasks and layer on top of this same drag interaction. This file owns only
 * the reorder surface + optimistic persistence + rollback (Task 10.3).
 *
 * All visible strings are pre-resolved server-side and passed in via `labels`,
 * so this client component never needs to know the active locale (Requirement
 * 2.5).
 *
 * Requirements: 4.1, 4.4, 4.5, 4.6, 4.8, 4.10, 5.1, 5.2, 5.3, 5.10, 8.9,
 *               14.2.4, 14.2.5, 14.2.6, 14.4.11
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion, LayoutGroup } from "framer-motion";
import { GripVertical } from "lucide-react";

import type { QueueTask } from "@/lib/services/task.service";
import { reorderQueueAction } from "@/app/actions/task";

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
  /** Drag-and-drop accessibility / feedback (Task 10.3). */
  dragHandle: string;
  reorderFailed: string;
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
  // The full queue (parents + subtasks). Kept in state so optimistic reorders
  // of the parent list can update the rendered order without a round-trip.
  const [tasks, setTasks] = useState<QueueTask[]>(initialTasks);
  // Toast surfaced when a reorder Server Action fails (Requirement 14.2.5).
  const [reorderError, setReorderError] = useState<string | null>(null);
  // The task currently being dragged, rendered under <DragOverlay> for the
  // elevated-shadow visual feedback (Requirement 5.2).
  const [activeTask, setActiveTask] = useState<QueueTask | null>(null);
  // Pending reorder flag — disables the drag handle while a Server Action is
  // in flight to prevent overlapping optimistic updates.
  const [isPersisting, setIsPersisting] = useState(false);
  // Snapshot used for rollback if the Server Action fails (Requirement 14.2.5).
  const rollbackSnapshotRef = useRef<QueueTask[] | null>(null);

  // Pointer sensor requires a small movement threshold so a plain click never
  // starts a drag (keeps future tap-to-complete interactions intact).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Split into Parent Tasks (draggable cards) and SubTasks (nested). Rebuild
  // the map on every render so an optimistic reorder is reflected immediately.
  const parents = useMemo(
    () => tasks.filter((t) => !t.task.isSubTask),
    [tasks],
  );
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, QueueTask[]>();
    for (const t of tasks) {
      if (t.task.isSubTask && t.task.parentTaskId) {
        const list = map.get(t.task.parentTaskId);
        if (list) {
          list.push(t);
        } else {
          map.set(t.task.parentTaskId, [t]);
        }
      }
    }
    return map;
  }, [tasks]);

  // Empty state with illustration + motivational copy (Requirement 4.10).
  if (initialTasks.length === 0) {
    return <EmptyState labels={labels} />;
  }

  // ─── Drag handlers ──────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    const task = parents.find((t) => t.task.id === id);
    if (task) setActiveTask(task);
  }, [parents]);

  /**
   * On drop: reorder the parent list optimistically, persist via the Server
   * Action, and roll back + toast on failure (Requirements 5.3, 14.2.4,
   * 14.2.5). SubTasks always stay anchored to their parent (Requirement
   * 14.2.6) — only the `parents` array is reordered.
   */
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);

      if (!over || active.id === over.id) return;

      const oldIndex = parents.findIndex((t) => t.task.id === String(active.id));
      const newIndex = parents.findIndex((t) => t.task.id === String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      // Optimistic update — compute the new parent order, then rebuild the
      // full task list so subtasks remain nested under their (moved) parent.
      const nextParents = arrayMove(parents, oldIndex, newIndex);
      const nextTasks: QueueTask[] = [];
      for (const parent of nextParents) {
        nextTasks.push(parent);
        const nested = subtasksByParent.get(parent.task.id) ?? [];
        nextTasks.push(...nested);
      }

      // Snapshot for rollback (Requirement 14.2.5).
      rollbackSnapshotRef.current = tasks;
      setTasks(nextTasks);
      setReorderError(null);
      setIsPersisting(true);

      // Persist the new parent-task order (Requirement 5.3). The Server Action
      // assigns sequential positions so the hybrid sort reproduces the exact
      // dragged order on the next render.
      const result = await reorderQueueAction({
        orderedTaskIds: nextParents.map((p) => p.task.id),
      });

      setIsPersisting(false);

      if (!result.success) {
        // Roll back to the pre-drag order and surface a toast.
        const snapshot = rollbackSnapshotRef.current ?? initialTasks;
        setTasks(snapshot);
        setReorderError(labels.reorderFailed);
      }
      rollbackSnapshotRef.current = null;
    },
    [parents, subtasksByParent, tasks, initialTasks, labels.reorderFailed],
  );

  const dismissError = useCallback(() => setReorderError(null), []);

  return (
    <LayoutGroup>
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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveTask(null)}
        >
          <SortableContext
            items={parents.map((p) => p.task.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="flex flex-col gap-3" role="list">
              {parents.map((task) => {
                const nested = subtasksByParent.get(task.task.id) ?? [];
                return (
                  <SortableTaskCard
                    key={task.task.id}
                    task={task}
                    nested={nested}
                    labels={labels}
                    disabled={isPersisting}
                  />
                );
              })}
            </ol>
          </SortableContext>

          {/* Elevated-shadow visual feedback while dragging (Requirement 5.2). */}
          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <TaskCard
                task={activeTask}
                nested={subtasksByParent.get(activeTask.task.id) ?? []}
                labels={labels}
                dragging
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Reorder failure toast (Requirement 14.2.5). */}
      <AnimatePresence>
        {reorderError ? (
          <ReorderErrorToast message={reorderError} onDismiss={dismissError} />
        ) : null}
      </AnimatePresence>
    </LayoutGroup>
  );
}

// ─── Sortable parent card ──────────────────────────────────────────────────

interface SortableTaskCardProps {
  task: QueueTask;
  nested: QueueTask[];
  labels: TaskQueueLabels;
  disabled: boolean;
}

function SortableTaskCard({
  task,
  nested,
  labels,
  disabled,
}: SortableTaskCardProps): React.ReactNode {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.task.id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <motion.li
      ref={setNodeRef}
      style={style}
      layout
      // Micro-animation capped under 300ms (Requirement 14.4.11).
      transition={{ type: "spring", stiffness: 500, damping: 40, duration: 0.25 }}
      role="listitem"
      className={
        isDragging
          ? // Placeholder: the in-place slot becomes a quiet outline while the
            // dragged card is rendered under <DragOverlay>.
            "rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 p-4 opacity-60 dark:border-zinc-700 dark:bg-zinc-900/40"
          : "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      }
    >
      <TaskCard
        task={task}
        nested={nested}
        labels={labels}
        dragging={isDragging}
        dragHandleProps={{ attributes, listeners }}
        dragHandleLabel={labels.dragHandle}
      />
    </motion.li>
  );
}

// ─── Task card ──────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: QueueTask;
  nested: QueueTask[];
  labels: TaskQueueLabels;
  /** True while this card is the active drag overlay / placeholder. */
  dragging?: boolean;
  /** Drag-handle listeners for the sort context (parent cards only). */
  dragHandleProps?: {
    attributes: Record<string, unknown>;
    listeners: Record<string, () => void>;
  };
  dragHandleLabel?: string;
}

function TaskCard({
  task,
  nested,
  labels,
  dragging = false,
  dragHandleProps,
  dragHandleLabel,
}: TaskCardProps): React.ReactNode {
  const isSlaBreach = task.timeUrgency >= 10000; // max urgency bucket
  const statusLabel = statusToLabel(task.progress.status, labels);

  return (
    <div
      className={
        dragging
          ? // Elevated card shadow for the drag overlay (Requirement 5.2).
            "flex flex-col gap-3 rounded-xl bg-white shadow-2xl ring-2 ring-zinc-900/10 dark:bg-zinc-900"
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

        {/* Right rail: priority score + drag handle (parent cards only). */}
        <div className="flex shrink-0 items-start gap-1.5">
          {/* Priority score — the queue's reason to exist; show it quietly. */}
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
              {...(dragHandleProps.attributes as Record<string, unknown>)}
              {...(dragHandleProps.listeners as Record<string, unknown>)}
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
              <SubTaskRow key={sub.task.id} task={sub} labels={labels} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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

// ─── Reorder failure toast (Requirement 14.2.5) ─────────────────────────────

function ReorderErrorToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.ReactNode {
  return (
    <motion.div
      role="alert"
      aria-live="assertive"
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-white px-4 py-3 shadow-lg dark:border-red-900 dark:bg-zinc-900">
        <span className="text-sm font-medium text-red-700 dark:text-red-300">
          {message}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
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
