"use client";

import React from "react";
import type { CelebrationContext } from "@/lib/services/task.service";

interface AcademicComebackModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: CelebrationContext | null;
}

export function AcademicComebackModal({
  isOpen,
  onClose,
  context,
}: AcademicComebackModalProps): React.ReactNode {
  if (!isOpen || !context) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-2xl bg-zinc-950 border border-zinc-800 p-6 text-center text-white shadow-2xl">
        <h2 className="text-2xl font-black tracking-wider text-amber-500 animate-bounce">
          THE ACADEMIC COMEBACK IS REAL!
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          You completed an Overcooked task!
        </p>

        <div className="my-6 rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-xs uppercase tracking-widest text-zinc-500">
            Stress Drop
          </div>
          <div className="mt-1 text-3xl font-extrabold text-emerald-400">
            -{context.stressDrop.toLocaleString()}
          </div>
          <div className="mt-3 text-xs text-zinc-405">
            Tier: {context.oldTier} → {context.newTier}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-white py-3 text-sm font-bold text-black hover:bg-zinc-200 transition-colors"
        >
          Let's Go!
        </button>
      </div>
    </div>
  );
}
