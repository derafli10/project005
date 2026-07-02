"use client";

import { useState } from "react";
import { createTaskAction } from "@/app/actions/task";
import { Loader2, Check, Users } from "lucide-react";

/** A classroom option for the "Share to Class" dropdown. */
export interface ClassroomOption {
  id: string;
  className: string;
  sksWeight: number;
}

export interface CreateTaskFormLabels {
  title: string;
  titleLabel: string;
  titlePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  taskWeightLabel: string;
  taskWeightHint: string;
  sksWeightLabel: string;
  deadlineLabel: string;
  classRoomLabel: string;
  classRoomNone: string;
  submit: string;
  success: string;
  cancel: string;
}

interface CreateTaskFormProps {
  onClose: () => void;
  classrooms: ClassroomOption[];
  labels: CreateTaskFormLabels;
}

export function CreateTaskForm({
  onClose,
  classrooms,
  labels,
}: CreateTaskFormProps): React.ReactNode {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskWeight, setTaskWeight] = useState(5000);
  const [sksWeight, setSksWeight] = useState<number | undefined>(undefined);
  const [deadline, setDeadline] = useState("");
  const [classRoomId, setClassRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [created, setCreated] = useState<{
    id: string;
    title: string;
    classRoomId: string | null;
  } | null>(null);

  // When a classroom is selected, inherit its SKS weight as default.
  const handleClassroomChange = (value: string) => {
    setClassRoomId(value);
    if (value) {
      const match = classrooms.find((c) => c.id === value);
      if (match && sksWeight === undefined) {
        setSksWeight(match.sksWeight);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !deadline) return;

    setLoading(true);
    setError(null);
    setFieldErrors({});

    const result = await createTaskAction({
      title: title.trim(),
      description: description.trim() || undefined,
      taskWeight,
      sksWeight,
      deadlineAt: new Date(deadline).toISOString(),
      classRoomId: classRoomId || undefined,
    });

    setLoading(false);

    if (result.success) {
      setCreated(result.data);
    } else {
      setError(result.error);
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
      }
    }
  };

  // ─── Success state ──────────────────────────────────────────────────────

  if (created) {
    return (
      <div className="flex flex-col items-center p-6 text-center space-y-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
          <Check className="h-7 w-7" />
        </div>

        <div>
          <h3 className="text-lg font-extrabold text-zinc-900 dark:text-zinc-50">
            {labels.success}
          </h3>
          <p className="mt-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {created.title}
          </p>
        </div>

        {created.classRoomId && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-50/60 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:bg-blue-950/20 dark:text-blue-350">
            <Users className="h-3.5 w-3.5" />
            <span>Task shared to class</span>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full bg-zinc-950 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-900 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Done
        </button>
      </div>
    );
  }

  // ─── Form ───────────────────────────────────────────────────────────────

  // Minimum deadline: tomorrow at midnight
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const minDeadline = tomorrow.toISOString().slice(0, 16);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
          {labels.title}
        </h3>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Title */}
        <div>
          <label htmlFor="ct-title" className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {labels.titleLabel}
          </label>
          <input
            type="text"
            id="ct-title"
            required
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={labels.titlePlaceholder}
            className={`mt-1.5 block w-full rounded-xl border bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:outline-none focus:ring-1 dark:bg-zinc-900 dark:text-zinc-50 ${
              fieldErrors.title
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-zinc-200 focus:border-zinc-950 focus:ring-zinc-950 dark:border-zinc-800 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
            }`}
          />
          {fieldErrors.title && (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{fieldErrors.title[0]}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="ct-desc" className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {labels.descriptionLabel}
          </label>
          <textarea
            id="ct-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={labels.descriptionPlaceholder}
            rows={2}
            className="mt-1.5 block w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
          />
        </div>

        {/* Task Weight + Deadline row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ct-weight" className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {labels.taskWeightLabel}
            </label>
            <div className="relative mt-1.5">
              <input
                type="number"
                id="ct-weight"
                required
                min={0}
                max={10000}
                step={100}
                value={taskWeight}
                onChange={(e) => setTaskWeight(Number(e.target.value))}
                className={`block w-full rounded-xl border bg-white px-4 py-3 pr-10 text-sm text-zinc-900 shadow-sm focus:outline-none focus:ring-1 dark:bg-zinc-900 dark:text-zinc-50 ${
                  fieldErrors.taskWeight
                    ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                    : "border-zinc-200 focus:border-zinc-950 focus:ring-zinc-950 dark:border-zinc-800 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
                }`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-400 dark:text-zinc-500">
                bp
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-400">{labels.taskWeightHint}</p>
          </div>

          <div>
            <label htmlFor="ct-deadline" className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {labels.deadlineLabel}
            </label>
            <input
              type="datetime-local"
              id="ct-deadline"
              required
              min={minDeadline}
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className={`mt-1.5 block w-full rounded-xl border bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:outline-none focus:ring-1 dark:bg-zinc-900 dark:text-zinc-50 ${
                fieldErrors.deadlineAt
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-zinc-200 focus:border-zinc-950 focus:ring-zinc-950 dark:border-zinc-800 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
              }`}
            />
          </div>
        </div>

        {/* SKS Weight */}
        <div>
          <label htmlFor="ct-sks" className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {labels.sksWeightLabel}
          </label>
          <select
            id="ct-sks"
            value={sksWeight ?? ""}
            onChange={(e) => setSksWeight(e.target.value ? Number(e.target.value) : undefined)}
            className="mt-1.5 block w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
          >
            <option value="">Auto (from class or default 3)</option>
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v} value={v}>{v} SKS</option>
            ))}
          </select>
        </div>

        {/* Share to Class (optional classRoomId) — Requirement 8.6, 8.7, 8.8 */}
        {classrooms.length > 0 && (
          <div>
            <label htmlFor="ct-class" className="block text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {labels.classRoomLabel}
            </label>
            <select
              id="ct-class"
              value={classRoomId}
              onChange={(e) => handleClassroomChange(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-50 dark:focus:ring-zinc-50"
            >
              <option value="">{labels.classRoomNone}</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.className} (SKS {c.sksWeight})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="rounded-full px-5 py-2.5 text-xs font-bold text-zinc-500 transition-all hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          {labels.cancel}
        </button>
        <button
          type="submit"
          disabled={loading || !title.trim() || !deadline}
          className="flex items-center gap-2 rounded-full bg-zinc-950 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-zinc-900 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{labels.submit}</span>
        </button>
      </div>
    </form>
  );
}
