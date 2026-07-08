"use client";

/**
 * Wrapped Gallery Client Component.
 *
 * Displays a thumbnail gallery of user's past Academic Wrapped cards with
 * sharing functionality via Web Share API (mobile) or download button (desktop).
 *
 * Requirements: 11.9
 */

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Share2, Download, Calendar } from "lucide-react";
import type { AcademicWrapped } from "@/generated/prisma";

export interface WrappedGalleryClientProps {
  initialWrapped: AcademicWrapped[];
  labels: {
    weekRange: string;
    savedCredits: string;
    tasksCompleted: string;
    highestTier: string;
    streak: string;
    streakDays: string;
    shareStory: string;
    download: string;
    emptyTitle: string;
    emptyMessage: string;
  };
  locale: string;
}

export function WrappedGalleryClient({
  initialWrapped,
  labels,
  locale,
}: WrappedGalleryClientProps): React.ReactNode {
  const [cards] = useState(initialWrapped);
  const [sharingCardId, setSharingCardId] = useState<string | null>(null);

  // Detect if Web Share API is available
  const canShare =
    typeof window !== "undefined" &&
    typeof navigator.share !== "undefined" &&
    navigator.canShare !== undefined;

  const handleShare = async (card: AcademicWrapped) => {
    if (!card.imageUrl) return;

    setSharingCardId(card.id);

    try {
      if (canShare) {
        // Web Share API (mobile)
        const response = await fetch(card.imageUrl);
        const blob = await response.blob();
        const file = new File([blob], "academic-wrapped.png", {
          type: "image/png",
        });

        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: "Academic Wrapped",
            text: `Check out my week: ${formatWeekRange(card.weekStartDate, card.weekEndDate, locale)}`,
            files: [file],
          });
        } else {
          // Fallback if can't share files
          await navigator.share({
            title: "Academic Wrapped",
            text: `Check out my week: ${formatWeekRange(card.weekStartDate, card.weekEndDate, locale)}`,
            url: card.imageUrl,
          });
        }
      } else {
        // Desktop fallback: download
        const link = document.createElement("a");
        link.href = card.imageUrl;
        link.download = `wrapped-${card.weekStartDate.toISOString().slice(0, 10)}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      // User cancelled share or error occurred
      console.error("Share/download error:", error);
    } finally {
      setSharingCardId(null);
    }
  };

  if (cards.length === 0) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/60 p-8 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <Calendar className="h-7 w-7 text-zinc-400 dark:text-zinc-500" />
        </div>
        <h3 className="mb-2 text-lg font-bold text-zinc-900 dark:text-zinc-50">
          {labels.emptyTitle}
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {labels.emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card, index) => (
        <motion.article
          key={card.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05, duration: 0.3 }}
          className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* Card Image Thumbnail */}
          {card.imageUrl && (
            <div className="relative aspect-[9/16] overflow-hidden bg-gradient-to-br from-purple-900 via-indigo-900 to-purple-900">
              <img
                src={card.imageUrl}
                alt={`Academic Wrapped ${formatWeekRange(card.weekStartDate, card.weekEndDate, locale)}`}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/40" />
            </div>
          )}

          {/* Card Info */}
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Calendar className="h-3.5 w-3.5" />
              <span className="font-medium">
                {formatWeekRange(card.weekStartDate, card.weekEndDate, locale)}
              </span>
            </div>

            {/* Stats Grid */}
            <div className="mb-4 grid grid-cols-2 gap-3">
              <StatBadge
                label={labels.savedCredits}
                value={`${(card.totalSavedCredits / 100).toFixed(1)}%`}
              />
              <StatBadge
                label={labels.tasksCompleted}
                value={card.tasksCompleted.toString()}
              />
              <StatBadge label={labels.highestTier} value={card.highestTier} />
              <StatBadge
                label={labels.streak}
                value={labels.streakDays.replace(
                  "{count}",
                  card.streak.toString()
                )}
              />
            </div>

            {/* Share/Download Button */}
            <button
              type="button"
              onClick={() => handleShare(card)}
              disabled={sharingCardId === card.id}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:from-purple-700 hover:to-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:from-purple-500 dark:to-indigo-500"
            >
              {sharingCardId === card.id ? (
                <span className="animate-pulse">{labels.shareStory}</span>
              ) : (
                <>
                  {canShare ? (
                    <Share2 className="h-4 w-4" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span>{canShare ? labels.shareStory : labels.download}</span>
                </>
              )}
            </button>
          </div>
        </motion.article>
      ))}
    </div>
  );
}

// ─── HELPER COMPONENTS ──────────────────────────────────────────────────────

interface StatBadgeProps {
  label: string;
  value: string;
}

function StatBadge({ label, value }: StatBadgeProps): React.ReactNode {
  return (
    <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}

// ─── HELPER FUNCTIONS ───────────────────────────────────────────────────────

function formatWeekRange(
  start: Date | string,
  end: Date | string,
  locale: string
): string {
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = typeof end === "string" ? new Date(end) : end;

  const formatter = new Intl.DateTimeFormat(locale === "ID" ? "id-ID" : "en-US", {
    month: "short",
    day: "numeric",
  });

  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}
