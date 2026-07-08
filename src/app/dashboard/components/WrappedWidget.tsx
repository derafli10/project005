import Link from "next/link";
import { Calendar, TrendingUp } from "lucide-react";
import { academicWrappedService } from "@/lib/services/academic-wrapped.service";

/**
 * Academic Wrapped Widget — Server Component.
 *
 * Dashboard widget that displays a preview of the user's most recent Academic
 * Wrapped card with a link to view all past cards.
 *
 * Requirements: 11.9, 14.1
 */

export interface WrappedWidgetProps {
  label: string;
  ariaLabel: string;
  viewAllLabel: string;
  userId: string;
  locale: string;
  weekRangeTemplate: string;
  savedCreditsLabel: string;
  tasksCompletedLabel: string;
  emptyMessage: string;
}

export async function WrappedWidget({
  label,
  ariaLabel,
  viewAllLabel,
  userId,
  locale,
  weekRangeTemplate,
  savedCreditsLabel,
  tasksCompletedLabel,
  emptyMessage,
}: WrappedWidgetProps): Promise<React.ReactNode> {
  // Fetch the most recent wrapped card
  const wrappedHistory = await academicWrappedService.getUserWrappedHistory(
    userId,
    1
  );
  const latestCard = wrappedHistory[0] ?? null;

  return (
    <aside
      aria-label={ariaLabel}
      className="flex min-h-[10rem] flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:col-span-2 xl:col-span-2"
    >
      {/* Widget Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500">
            <Calendar className="h-4 w-4 text-white" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {label}
          </h3>
        </div>
        <Link
          href="/dashboard/wrapped"
          className="text-xs font-semibold text-purple-600 transition-colors hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
        >
          {viewAllLabel} →
        </Link>
      </div>

      {/* Widget Content */}
      {latestCard ? (
        <Link
          href="/dashboard/wrapped"
          className="group flex flex-1 flex-col gap-3 rounded-xl border border-zinc-100 bg-zinc-50/50 p-4 transition-all hover:border-purple-200 hover:bg-purple-50/50 dark:border-zinc-800 dark:bg-zinc-800/30 dark:hover:border-purple-800 dark:hover:bg-purple-950/20"
        >
          <div className="flex items-start justify-between gap-3">
            {/* Thumbnail */}
            {latestCard.imageUrl && (
              <div className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-gradient-to-br from-purple-900 via-indigo-900 to-purple-900 shadow-sm dark:border-zinc-700">
                <img
                  src={latestCard.imageUrl}
                  alt="Academic Wrapped"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </div>
            )}

            {/* Stats */}
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <Calendar className="h-3.5 w-3.5" />
                <span className="font-medium">
                  {formatWeekRange(
                    latestCard.weekStartDate,
                    latestCard.weekEndDate,
                    locale,
                    weekRangeTemplate
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <StatPill
                  icon={<TrendingUp className="h-3 w-3" />}
                  label={savedCreditsLabel}
                  value={`${(latestCard.totalSavedCredits / 100).toFixed(1)}%`}
                />
                <StatPill
                  label={tasksCompletedLabel}
                  value={latestCard.tasksCompleted.toString()}
                />
              </div>
            </div>
          </div>

          {/* View All Hint */}
          <div className="flex items-center justify-end gap-1 text-xs font-medium text-purple-600 dark:text-purple-400">
            <span>View all cards</span>
            <span className="transition-transform group-hover:translate-x-1">
              →
            </span>
          </div>
        </Link>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
            <Calendar className="h-6 w-6 text-zinc-400 dark:text-zinc-500" />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {emptyMessage}
          </p>
        </div>
      )}
    </aside>
  );
}

// ─── HELPER COMPONENTS ──────────────────────────────────────────────────────

interface StatPillProps {
  icon?: React.ReactNode;
  label: string;
  value: string;
}

function StatPill({ icon, label, value }: StatPillProps): React.ReactNode {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-white px-2 py-1.5 dark:bg-zinc-900/50">
      <div className="flex items-center gap-1">
        {icon}
        <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>
      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-50">
        {value}
      </span>
    </div>
  );
}

// ─── HELPER FUNCTIONS ───────────────────────────────────────────────────────

function formatWeekRange(
  start: Date,
  end: Date,
  locale: string,
  template: string
): string {
  const formatter = new Intl.DateTimeFormat(locale === "ID" ? "id-ID" : "en-US", {
    month: "short",
    day: "numeric",
  });

  const startStr = formatter.format(start);
  const endStr = formatter.format(end);

  return template.replace("{start}", startStr).replace("{end}", endStr);
}
