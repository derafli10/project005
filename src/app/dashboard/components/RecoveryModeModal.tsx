"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ShieldAlert, Sparkles, X } from "lucide-react";

import { getRecoveryCandidatesAction, activateRecoveryModeAction, type RecoveryCandidateView } from "@/app/actions/recovery";

export interface RecoveryModeModalLabels {
  title: string;
  message: string;
  activate: string;
  later: string;
  candidates: string;
  activatedTitle: string;
  cancel: string;
}

interface RecoveryModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  labels: RecoveryModeModalLabels;
}

export function RecoveryModeModal({
  isOpen,
  onClose,
  labels,
}: RecoveryModeModalProps): React.ReactNode {
  const [candidates, setCandidates] = useState<RecoveryCandidateView[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fetch candidate tasks when modal opens
  useEffect(() => {
    if (!isOpen) {
      setSuccessMsg(null);
      setSelectedIds([]);
      return;
    }

    async function loadCandidates() {
      setLoading(true);
      const res = await getRecoveryCandidatesAction();
      if (res.success && res.data) {
        setCandidates(res.data);
        // Pre-select all candidates by default
        setSelectedIds(res.data.map((t) => t.id));
      }
      setLoading(false);
    }

    loadCandidates();
  }, [isOpen]);

  const handleToggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleActivate = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    const res = await activateRecoveryModeAction({
      taskIdsToBreakdown: selectedIds,
    });
    setSubmitting(false);

    if (res.success && res.data) {
      setSuccessMsg(res.data.motivationalText);
      // Dispatch event to refresh layout and queue
      window.dispatchEvent(new CustomEvent("task-updated"));
      // Close the modal after a short delay so user can read the motivational text
      setTimeout(() => {
        onClose();
      }, 3500);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              disabled={submitting}
              className="absolute top-4 right-4 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
              aria-label={labels.cancel}
            >
              <X className="h-4 w-4" />
            </button>

            {successMsg ? (
              /* Success State */
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center py-6 text-center"
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <Sparkles className="h-6 w-6 animate-bounce" />
                </div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {labels.activatedTitle}
                </h3>
                <p className="mt-2 text-sm italic text-zinc-600 dark:text-zinc-400">
                  "{successMsg}"
                </p>
              </motion.div>
            ) : (
              /* Configuration / Consent State */
              <div>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400">
                    <ShieldAlert className="h-5 w-5 animate-pulse" />
                  </div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                    {labels.title}
                  </h3>
                </div>

                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {labels.message}
                </p>

                {/* Candidate Tasks Checklist */}
                <div className="my-4">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
                    {labels.candidates}
                  </h4>

                  {loading ? (
                    <div className="space-y-2 py-4">
                      <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                      <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                    </div>
                  ) : candidates.length > 0 ? (
                    <ul className="space-y-2">
                      {candidates.map((task) => {
                        const isChecked = selectedIds.includes(task.id);
                        return (
                          <li key={task.id}>
                            <button
                              type="button"
                              onClick={() => handleToggle(task.id)}
                              className={`flex w-full items-center justify-between rounded-2xl border p-3 text-left transition-all duration-200 ${
                                isChecked
                                  ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900/40"
                                  : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/20"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                                    isChecked
                                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                                      : "border-zinc-300 dark:border-zinc-700"
                                  }`}
                                >
                                  {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                                </div>
                                <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                                  {task.title}
                                </span>
                              </div>
                              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                SKS {task.sksWeight} • {(task.taskWeight / 100).toFixed(0)}%
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="py-4 text-center text-xs text-zinc-400">
                      No candidate tasks over threshold
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="order-2 rounded-full px-5 py-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900 sm:order-1"
                  >
                    {labels.later}
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.length === 0 || submitting}
                    onClick={handleActivate}
                    className="order-1 flex items-center justify-center rounded-full bg-zinc-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-50 sm:order-2"
                  >
                    {submitting ? "activating..." : labels.activate}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
