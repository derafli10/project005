"use client";

/**
 * TaskEditHistory — collapsible audit-trail timeline for a single Task.
 *
 * Renders a "View History" toggle that expands into a chronological list of
 * `TaskEditLog` entries (newest first), each showing the field that changed,
 * who changed it, a relative timestamp, and an old → new value comparison
 * rendered side-by-side.
 *
 * Data is fetched lazily via `getTaskEditHistoryAction` the first time the
 * timeline is expanded, so a task with no viewers of its history never pays
 * the query cost (Requirement 9.6).
 *
 * All visible strings are pre-resolved server-side and passed in via
 * `labels`, consistent with `TaskCard` / `TaskQueueClient` (Requirement 2.5).
 *
 * Requirements: 9.4, 9.5, 9.6
 */

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, History } from "lucide-react";

import { getTaskEditHistoryAction } from "@/app/actions/task";
import type { TaskEditHistoryEntry } from "@/lib/services/task.service";

// ─── Relative time (self-contained, mirrors i18n/utils.formatRelativeTime) ──
// Kept local (rather than importing `@/i18n/utils`) so this Client Component
// doesn't pull the server-oriented locale-negotiation dependency into the
// browser bundle — same pattern as `TaskCard.tsx`'s local `formatDeadline`.

function formatRelativeTime(date: Date, locale: "EN" | "ID"): string {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (locale === "ID") {
    if (diffMinutes < 1) return "baru saja";
    if (diffMinutes < 60) return `${diffMinutes} menit lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    if (diffDays === 1) return "kemarin";
    return `${diffDays} hari lalu`;
  }

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60)
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  if (diffHours < 24)
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays === 1) return "yesterday";
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatDeadlineValue(iso: string, locale: "EN" | "ID"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const datePart =
    locale === "ID" ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  return `${datePart} ${hh}:${mm}`;
}

/** Formats a raw TaskEditLog value string for display, based on its field. */
function formatFieldValue(
  fieldName: string,
  raw: string,
  locale: "EN" | "ID",
): string {
  switch (fieldName) {
    case "deadlineAt":
      return formatDeadlineValue(raw, locale);
    case "taskWeight": {
      const n = Number(raw);
      return Number.isFinite(n) ? `${Math.round((n / 10000) * 100)}%` : raw;
    }
    case "sksWeight":
      return raw;
    default:
      return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  }
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export interface TaskEditHistoryLabels {
  /** Toggle button label, e.g. "View History". */
  viewHistory: string;
  /** Timeline heading, e.g. "Task History". */
  title: string;
  /** Per-field display names, keyed by TaskEditLog.fieldName. */
  fieldLabels: Record<string, string>;
  /** Template with `{name}` placeholder, e.g. "Updated by {name}". */
  updatedByTemplate: string;
  /** Shown while the timeline is loading. */
  loading: string;
  /** Shown when a Task has no edit history yet. */
  empty: string;
  /** Shown if the fetch fails. */
  errorGeneric: string;
  locale: "EN" | "ID";
}

interface TaskEditHistoryProps {
  taskId: string;
  labels: TaskEditHistoryLabels;
  /** Called once the timeline has been opened (used to mark logs as read — Task 13.2). */
  onOpen?: () => void;
}

export function TaskEditHistory({
  taskId,
  labels,
  onOpen,
}: TaskEditHistoryProps): React.ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const [entries, setEntries] = useState<TaskEditHistoryEntry[]>([]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        onOpen?.();
        if (status === "idle") {
          setStatus("loading");
          getTaskEditHistoryAction(taskId)
            .then((res) => {
              if (res.success) {
                setEntries(res.data);
                setStatus("loaded");
              } else {
                setStatus("error");
              }
            })
            .catch(() => setStatus("error"));
        }
      }
      return next;
    });
  }, [onOpen, status, taskId]);

  useEffect(() => {
    const handleOpenEvent = () => {
      setIsOpen((prev) => {
        if (!prev) {
          onOpen?.();
          if (status === "idle") {
            setStatus("loading");
            getTaskEditHistoryAction(taskId)
              .then((res) => {
                if (res.success) {
                  setEntries(res.data);
                  setStatus("loaded");
                } else {
                  setStatus("error");
                }
              })
              .catch(() => setStatus("error"));
          }
          return true;
        }
        return prev;
      });
    };

    window.addEventListener(`open-history-${taskId}`, handleOpenEvent);
    return () => {
      window.removeEventListener(`open-history-${taskId}`, handleOpenEvent);
    };
  }, [onOpen, status, taskId]);

  const fieldLabel = (fieldName: string): string =>
    labels.fieldLabels[fieldName] ?? fieldName;

  return (
    <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        className="flex min-h-8 items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{labels.viewHistory}</span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex items-center"
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            key="history-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-col gap-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {labels.title}
              </h4>

              {status === "loading" ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  {labels.loading}
                </p>
              ) : status === "error" ? (
                <p className="text-xs text-red-500 dark:text-red-400">
                  {labels.errorGeneric}
                </p>
              ) : entries.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  {labels.empty}
                </p>
              ) : (
                <ol className="relative flex flex-col gap-4 border-l border-zinc-200 pl-4 dark:border-zinc-800">
                  {entries.map((entry, index) => (
                    <motion.li
                      key={entry.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.2,
                        delay: Math.min(index, 6) * 0.04,
                        ease: "easeOut",
                      }}
                      className="relative"
                    >
                      <span
                        className="absolute -left-5.25 top-1 h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700"
                        aria-hidden="true"
                      />

                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                          {fieldLabel(entry.fieldName)}
                        </span>
                        <time
                          dateTime={entry.editedAt.toISOString()}
                          title={entry.editedAt.toLocaleString()}
                          className="text-[11px] text-zinc-400 dark:text-zinc-500"
                        >
                          {formatRelativeTime(entry.editedAt, labels.locale)}
                        </time>
                      </div>

                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {labels.updatedByTemplate.replace(
                          "{name}",
                          entry.editorName,
                        )}
                      </p>

                      <div className="mt-1.5 flex items-center gap-2 text-xs">
                        <span className="rounded-md bg-red-50 px-2 py-1 text-red-700 line-through decoration-red-400/70 dark:bg-red-950/30 dark:text-red-300">
                          {formatFieldValue(
                            entry.fieldName,
                            entry.oldValue,
                            labels.locale,
                          )}
                        </span>
                        <span
                          className="text-zinc-300 dark:text-zinc-600"
                          aria-hidden="true"
                        >
                          →
                        </span>
                        <span className="rounded-md bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                          {formatFieldValue(
                            entry.fieldName,
                            entry.newValue,
                            labels.locale,
                          )}
                        </span>
                      </div>
                    </motion.li>
                  ))}
                </ol>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
