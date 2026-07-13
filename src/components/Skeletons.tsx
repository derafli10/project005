"use client";

/**
 * TaskQueueSkeleton — Loading skeleton for the Task Queue widget.
 *
 * Renders a shimmer-pulsing placeholder that mirrors the real TaskCard layout
 * so there's zero layout shift when data arrives (CLS < 0.05 per perf bar).
 *
 * Uses Framer Motion `skeletonPulseVariants` so the shimmer can be killed
 * cleanly by `AnimatePresence` when the real data mounts.
 *
 * Requirements: 5.2, 14.1, 14.4
 */

import { motion } from "framer-motion";
import { skeletonPulseVariants } from "@/lib/motion-variants";

interface TaskQueueSkeletonProps {
  /** Number of skeleton cards to render. */
  count?: number;
}

export function TaskQueueSkeleton({
  count = 4,
}: TaskQueueSkeletonProps): React.ReactNode {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
      {/* Header skeleton */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="h-5 w-28 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="flex items-center gap-2">
          <div className="h-5 w-8 rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-7 w-20 rounded-full bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Card skeletons */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: count }, (_, i) => (
          <motion.div
            key={i}
            variants={skeletonPulseVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="rounded-xl border border-zinc-100 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            {/* Top row: drag handle + title + badge */}
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-4 w-4 rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/5 rounded bg-zinc-200 dark:bg-zinc-700" />
                <div className="h-3 w-4/5 rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
              <div className="h-5 w-16 rounded-full bg-zinc-200 dark:bg-zinc-700" />
            </div>

            {/* Micro-prompt skeleton */}
            <div className="mt-3 h-3 w-2/3 rounded bg-zinc-100 dark:bg-zinc-800" />

            {/* Bottom row: deadline + actions */}
            <div className="mt-3 flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="flex gap-2">
                <div className="h-6 w-6 rounded-md bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-6 w-6 rounded-md bg-zinc-100 dark:bg-zinc-800" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/**
 * CookedMeterSkeleton — Loading skeleton for the Cooked Meter widget.
 *
 * Requirements: 5.2, 14.1
 */
export function CookedMeterSkeleton(): React.ReactNode {
  return (
    <motion.aside
      variants={skeletonPulseVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex min-h-[16rem] flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
        </div>
        <div className="h-5 w-28 rounded-full bg-zinc-100 dark:bg-zinc-800" />
      </div>

      {/* Gauge area */}
      <div className="flex flex-1 items-center justify-center">
        <div className="h-28 w-28 rounded-full border-4 border-zinc-100 dark:border-zinc-800" />
      </div>

      {/* Sparkline area */}
      <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-900">
        <div className="mb-2 h-3 w-20 rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-16 w-full rounded bg-zinc-50 dark:bg-zinc-900" />
      </div>
    </motion.aside>
  );
}

/**
 * WidgetSkeleton — Generic loading skeleton for bento grid widgets.
 *
 * Requirements: 5.2, 14.1
 */
export function WidgetSkeleton(): React.ReactNode {
  return (
    <motion.aside
      variants={skeletonPulseVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex min-h-[10rem] flex-col rounded-2xl border border-zinc-200 bg-white/60 p-5 dark:border-zinc-800 dark:bg-zinc-950/40"
    >
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
      <div className="mt-4 space-y-2 flex-1">
        <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-3 w-3/4 rounded bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-3 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800" />
      </div>
    </motion.aside>
  );
}
