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
  type DraggableAttributes,
  type DraggableSyntheticListeners,
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
import { GripVertical, Plus, X } from "lucide-react";

import { TaskCard, type TaskCardLabels } from "./TaskCard";
import type { QueueTask } from "@/lib/services/task.service";
import { reorderQueueAction, reorderTaskAction, completeTaskAction } from "@/app/actions/task";
import { OverrideModal } from "./OverrideModal";
import { AcademicComebackModal } from "./AcademicComebackModal";
import { CreateTaskForm, type ClassroomOption, type CreateTaskFormLabels } from "./CreateTaskForm";

// ─── Labels (pre-localized server-side) ─────────────────────────────────────

export interface TaskQueueLabels extends TaskCardLabels {
  /** Section title for the queue widget. */
  title: string;
  /** Empty state (Requirement 4.10). */
  emptyTitle: string;
  emptyMessage: string;
  emptyCta: string;
  /** Drag-and-drop accessibility / feedback (Task 10.3). */
  dragHandle: string;
  reorderFailed: string;
  /** Relative time helper, pre-applied per-task by the Server Component. */
  locale: "EN" | "ID";
  /** Micro-prompt template key. */
  microPromptTemplate: string;
  overrideTitle: string;
  question: string;
  subtitle: string;
  optionMoreUrgent: string;
  optionNeedTeam: string;
  optionHarder: string;
  optionPersonal: string;
  personalPlaceholder: string;
  submit: string;
  cancel: string;
  /** Label for the "Create Task" button (Requirements 8.6, 8.7). */
  createTask: string;
  /** Pre-localized labels for the CreateTaskForm modal. */
  createTaskFormLabels: CreateTaskFormLabels;
}

interface TaskQueueClientProps {
  /** Initial queue, already sorted by the Server Component (Req 4.2, 4.3). */
  initialTasks: QueueTask[];
  /** Classrooms the user belongs to, for the "Share to Class" dropdown. */
  classrooms: ClassroomOption[];
  labels: TaskQueueLabels;
}

export function TaskQueueClient({
  initialTasks,
  classrooms,
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

  // State for collecting manual override reason (Task 10.5).
  const [pendingOverride, setPendingOverride] = useState<{
    taskId: string;
    oldIndex: number;
    newIndex: number;
    nextParents: QueueTask[];
    nextTasks: QueueTask[];
  } | null>(null);

  // State for the Create Task modal (Requirements 8.6, 8.7, 8.8).
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // State for Academic Comeback celebration (Task 10.6)
  const [isComebackModalOpen, setIsComebackModalOpen] = useState(false);
  const [celebrationContext, setCelebrationContext] = useState<import("@/lib/services/task.service").CelebrationContext | null>(null);

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

      // Open the override modal instead of persisting directly
      setPendingOverride({
        taskId: String(active.id),
        oldIndex,
        newIndex,
        nextParents,
        nextTasks,
      });
    },
    [parents, subtasksByParent, tasks],
  );

  const handleConfirmOverride = useCallback(
    async (reason: string) => {
      if (!pendingOverride) return;
      const { taskId, oldIndex, newIndex, nextParents } = pendingOverride;
      setPendingOverride(null);
      setIsPersisting(true);

      // Persist the reason for manual override (Requirement 5.6)
      const recordResult = await reorderTaskAction({
        taskId,
        oldPosition: oldIndex,
        newPosition: newIndex,
        reason,
      });

      if (!recordResult.success) {
        setIsPersisting(false);
        const snapshot = rollbackSnapshotRef.current ?? initialTasks;
        setTasks(snapshot);
        setReorderError(recordResult.error || labels.reorderFailed);
        rollbackSnapshotRef.current = null;
        return;
      }

      // Update positions of all parent tasks (Requirement 5.3)
      const reorderResult = await reorderQueueAction({
        orderedTaskIds: nextParents.map((p) => p.task.id),
      });

      setIsPersisting(false);

      if (!reorderResult.success) {
        const snapshot = rollbackSnapshotRef.current ?? initialTasks;
        setTasks(snapshot);
        setReorderError(labels.reorderFailed);
      } else {
        window.dispatchEvent(new CustomEvent("task-updated"));
      }
      rollbackSnapshotRef.current = null;
    },
    [pendingOverride, labels.reorderFailed, initialTasks],
  );

  const handleCancelOverride = useCallback(() => {
    setPendingOverride(null);
    const snapshot = rollbackSnapshotRef.current ?? initialTasks;
    setTasks(snapshot);
    rollbackSnapshotRef.current = null;
  }, [initialTasks]);

  const handleCompleteTask = useCallback(
    async (taskId: string) => {
      const snapshot = tasks;
      const target = tasks.find((t) => t.task.id === taskId);
      if (!target) return;

      // Optimistic UI: filter out completed task.
      // If it's a parent, also filter out its nested subtasks. If it's a subtask, just filter out the subtask.
      const nextTasks = tasks.filter(
        (t) => t.task.id !== taskId && (!(!target.task.isSubTask && t.task.parentTaskId === taskId))
      );

      setTasks(nextTasks);
      setReorderError(null);

      const result = await completeTaskAction(taskId);

      if (!result.success) {
        setTasks(snapshot);
        setReorderError(result.error || labels.reorderFailed);
        return;
      }

      window.dispatchEvent(new CustomEvent("task-updated"));

      // If Academic Comeback is triggered (celebration context exists), show the modal
      if (result.data?.triggerCelebration && result.data.celebrationContext) {
        setCelebrationContext(result.data.celebrationContext);
        setIsComebackModalOpen(true);
      }
    },
    [tasks, labels.reorderFailed],
  );

  const dismissError = useCallback(() => setReorderError(null), []);

  // Empty state with illustration + motivational copy (Requirement 4.10).
  // Placed AFTER all hooks so the Rules of Hooks are satisfied even as the
  // queue transitions to/from empty.
  if (parents.length === 0) {
    return (
      <>
        <EmptyState labels={labels} onCreateTask={() => setIsCreateModalOpen(true)} />
        <CreateTaskModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          classrooms={classrooms}
          labels={labels.createTaskFormLabels}
        />
      </>
    );
  }

  return (
    <LayoutGroup>
      <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {labels.title}
          </h2>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              aria-label={`${parents.length} ${labels.title}`}
            >
              {parents.length}
            </span>
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              aria-label={labels.createTask}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{labels.createTask}</span>
            </button>
          </div>
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
                    onComplete={handleCompleteTask}
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

      {/* Override feedback modal (Requirement 5.4) */}
      <OverrideModal
        isOpen={pendingOverride !== null}
        onConfirm={handleConfirmOverride}
        onCancel={handleCancelOverride}
        labels={labels}
      />

      {/* Academic Comeback celebration modal (Requirement 12.6) */}
      <AcademicComebackModal
        isOpen={isComebackModalOpen}
        onClose={() => setIsComebackModalOpen(false)}
        context={celebrationContext}
      />

      {/* Create Task modal (Requirements 8.6, 8.7, 8.8) */}
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        classrooms={classrooms}
        labels={labels.createTaskFormLabels}
      />

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
  onComplete: (taskId: string) => void;
}

function SortableTaskCard({
  task,
  nested,
  labels,
  disabled,
  onComplete,
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
      id={`task-card-${task.task.id}`}
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
        onComplete={onComplete}
      />
    </motion.li>
  );
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

// ─── Empty state (Requirement 4.10) ─────────────────────────────────────────

function EmptyState({
  labels,
  onCreateTask,
}: {
  labels: TaskQueueLabels;
  onCreateTask: () => void;
}): React.ReactNode {
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
      <button
        type="button"
        onClick={onCreateTask}
        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-zinc-900 px-4 text-xs font-medium text-white transition-all hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Plus className="h-3.5 w-3.5" />
        {labels.emptyCta}
      </button>
    </div>
  );
}

// ─── Create Task modal dialog ────────────────────────────────────────────────

function CreateTaskModal({
  isOpen,
  onClose,
  classrooms,
  labels,
}: {
  isOpen: boolean;
  onClose: () => void;
  classrooms: ClassroomOption[];
  labels: CreateTaskFormLabels;
}): React.ReactNode {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="create-task-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Panel */}
          <motion.div
            className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:p-6"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 500, damping: 35, duration: 0.25 }}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <CreateTaskForm
              onClose={onClose}
              classrooms={classrooms}
              labels={labels}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
