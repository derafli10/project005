"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  backdropVariants,
  bottomSheetVariants,
  MODAL_SPRING,
} from "@/lib/motion-variants";

export interface OverrideModalLabels {
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
}

interface OverrideModalProps {
  isOpen: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  labels: OverrideModalLabels;
}

export function OverrideModal({
  isOpen,
  onConfirm,
  onCancel,
  labels,
}: OverrideModalProps): React.ReactNode {
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [customReason, setCustomReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const quickOptions = [
    { id: "more_urgent", text: labels.optionMoreUrgent },
    { id: "need_team", text: labels.optionNeedTeam },
    { id: "harder", text: labels.optionHarder },
    { id: "personal", text: labels.optionPersonal },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let finalReason = "";
    if (selectedOption === "personal") {
      finalReason = customReason.trim();
      if (finalReason.length < 3) {
        setError("Alasan harus minimal 3 karakter");
        return;
      }
    } else {
      const found = quickOptions.find((opt) => opt.id === selectedOption);
      finalReason = found ? found.text : "";
    }

    if (!finalReason) {
      setError("Silakan pilih salah satu alasan");
      return;
    }

    onConfirm(finalReason);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onCancel}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Bottom Sheet */}
          <motion.div
            variants={bottomSheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={MODAL_SPRING}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-3xl border-t border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:mx-auto sm:max-w-lg"
          >
            {/* Drag Handle Indicator */}
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-zinc-300 dark:bg-zinc-800" />

            <div className="mb-4">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                {labels.overrideTitle}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {labels.subtitle}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto">
              <div className="flex flex-col gap-2">
                {quickOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setSelectedOption(option.id);
                      setError(null);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-sm font-medium transition-all ${
                      selectedOption === option.id
                        ? "border-amber-500 bg-amber-50/50 text-amber-900 dark:border-amber-400 dark:bg-amber-950/30 dark:text-amber-100"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-850"
                    }`}
                  >
                    <span>{option.text}</span>
                    <div
                      className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center ${
                        selectedOption === option.id
                          ? "border-amber-500 bg-amber-500 dark:border-amber-400 dark:bg-amber-400"
                          : "border-zinc-350 dark:border-zinc-700"
                      }`}
                    >
                      {selectedOption === option.id && (
                        <div className="h-1.5 w-1.5 rounded-full bg-white dark:bg-zinc-950" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Custom reason input for Personal Reason */}
              {selectedOption === "personal" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="flex flex-col gap-1.5"
                >
                  <textarea
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder={labels.personalPlaceholder}
                    rows={3}
                    className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-650"
                  />
                </motion.div>
              )}

              {error && (
                <p className="text-xs font-semibold text-red-650 dark:text-red-400">
                  {error}
                </p>
              )}

              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 rounded-xl border border-zinc-200 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  {labels.cancel}
                </button>
                <button
                  type="submit"
                  disabled={!selectedOption}
                  className="flex-1 rounded-xl bg-amber-550 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-600"
                >
                  {labels.submit}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
