import "server-only";

import { baseDb } from "@/lib/db";
import { CookedMeterService } from "./cooked-meter.service";
import { determineCookedTier } from "./task.service";
import type { AcademicWrapped, CookedTier } from "@/generated/prisma";

/**
 * Academic Wrapped Service
 *
 * Generates weekly achievement summaries for social sharing.
 *
 * Key behaviors:
 *  - `calculateWeekStats` sums taskWeight for COMPLETED tasks in a given week
 *    range via UserTaskProgress.completedAt (Requirement 11.2).
 *  - Calculates streak: consecutive days with ≥1 completed task within the week.
 *  - Determines the highest tier reached during the week from CookedScore
 *    daily snapshots (Requirement 11.4).
 *  - `saveWrappedRecord` upserts an AcademicWrapped record with composite
 *    unique [userId, weekStartDate] (Requirement 11.10).
 *
 * Reference: design.md > Academic Wrapped Service, Requirements 11.1, 11.2, 11.10.
 */

/** Shape of the weekly statistics payload. */
export interface WeekStats {
  /** Sum of taskWeight for COMPLETED tasks in basis points. */
  totalSavedCredits: number;
  /** Count of completed tasks during the week. */
  tasksCompleted: number;
  /** Highest CookedTier reached during the week from CookedScore records. */
  highestTier: CookedTier;
  /** Consecutive days with ≥1 completed task within the week. */
  streak: number;
}

/** Ordinal mapping for tier comparison (higher = worse stress). */
const TIER_ORDINAL: Record<CookedTier, number> = {
  MAIN_CHARACTER: 0,
  LET_HIM_COOK: 1,
  SLIGHTLY_COOKED: 2,
  OVERCOOKED: 3,
} as const;

/**
 * Get the Monday 00:00:00 UTC of the week containing `date`.
 */
function getWeekStartDate(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  // How many days to subtract to get to Monday:
  const daysToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the Sunday 23:59:59.999 UTC of the week containing `date`.
 */
function getWeekEndDate(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + 6);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export class AcademicWrappedService {
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Calculate weekly statistics for a user's completed tasks.
   *
   * - **totalSavedCredits**: SUM(task.taskWeight) for all tasks where the
   *   user's UserTaskProgress.status = COMPLETED AND completedAt falls
   *   within [weekStartDate Monday 00:00, weekEndDate Sunday 23:59:59.999]
   *   (Requirement 11.2).
   * - **tasksCompleted**: COUNT of such records.
   * - **highestTier**: Maximum CookedTier from CookedScore daily snapshots
   *   within the week (Requirement 11.4).
   * - **streak**: Longest run of consecutive days within the week where the
   *   user completed ≥1 task.
   *
   * @param userId         The user's ID.
   * @param weekStartDate  Monday 00:00 UTC of the target week.
   * @returns Computed weekly stats.
   */
  static async calculateWeekStats(
    userId: string,
    weekStartDate: Date
  ): Promise<WeekStats> {
    const weekEnd = getWeekEndDate(weekStartDate);

    // ── 1. Fetch completed tasks in the week range ──────────────────────
    // Use UserTaskProgress.completedAt as the authoritative completion
    // timestamp. Join with Task to get taskWeight.
    const completedProgress = await baseDb.userTaskProgress.findMany({
      where: {
        userId,
        status: "COMPLETED",
        completedAt: {
          gte: weekStartDate,
          lte: weekEnd,
        },
      },
      select: {
        completedAt: true,
        task: {
          select: {
            taskWeight: true,
          },
        },
      },
    });

    // ── 2. Compute totalSavedCredits and tasksCompleted ─────────────────
    let totalSavedCredits = 0;
    const tasksCompleted = completedProgress.length;

    for (const row of completedProgress) {
      totalSavedCredits += row.task.taskWeight;
    }

    // ── 3. Compute the highest tier from CookedScore records ────────────
    // Fetch all daily CookedScore snapshots within the week.
    const cookedScores = await baseDb.cookedScore.findMany({
      where: {
        userId,
        date: {
          gte: weekStartDate,
          lte: weekEnd,
        },
      },
      select: {
        tier: true,
      },
    });

    let highestTier: CookedTier = "MAIN_CHARACTER";
    for (const score of cookedScores) {
      if (TIER_ORDINAL[score.tier] > TIER_ORDINAL[highestTier]) {
        highestTier = score.tier;
      }
    }

    // ── 4. Compute streak (consecutive days with ≥1 completion) ─────────
    // Build a set of UTC day offsets (0=Mon, 1=Tue, … 6=Sun) that had
    // at least one completion.
    const completionDays = new Set<number>();
    for (const row of completedProgress) {
      if (row.completedAt) {
        // Day offset from weekStartDate
        const dayOffset = Math.floor(
          (row.completedAt.getTime() - weekStartDate.getTime()) / (24 * 60 * 60 * 1000)
        );
        if (dayOffset >= 0 && dayOffset <= 6) {
          completionDays.add(dayOffset);
        }
      }
    }

    // Find the longest consecutive run within the 7-day window.
    let streak = 0;
    let currentRun = 0;
    for (let day = 0; day < 7; day++) {
      if (completionDays.has(day)) {
        currentRun++;
        if (currentRun > streak) {
          streak = currentRun;
        }
      } else {
        currentRun = 0;
      }
    }

    return {
      totalSavedCredits,
      tasksCompleted,
      highestTier,
      streak,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Persist (upsert) an AcademicWrapped record to the database.
   *
   * Uses the composite unique constraint [userId, weekStartDate] to
   * ensure exactly one record per user per week (Requirement 11.10).
   *
   * @param userId         The user's ID.
   * @param weekStartDate  Monday 00:00 UTC of the target week.
   * @param stats          The computed weekly stats.
   * @param imageUrl       Optional CDN URL of the generated card image.
   * @returns The created or updated AcademicWrapped record.
   */
  static async saveWrappedRecord(
    userId: string,
    weekStartDate: Date,
    stats: WeekStats,
    imageUrl?: string
  ): Promise<AcademicWrapped> {
    const weekEnd = getWeekEndDate(weekStartDate);

    // Normalize dates to midnight UTC Date-only (for @db.Date columns).
    const normalizedStart = new Date(
      Date.UTC(
        weekStartDate.getUTCFullYear(),
        weekStartDate.getUTCMonth(),
        weekStartDate.getUTCDate()
      )
    );
    const normalizedEnd = new Date(
      Date.UTC(weekEnd.getUTCFullYear(), weekEnd.getUTCMonth(), weekEnd.getUTCDate())
    );

    return baseDb.academicWrapped.upsert({
      where: {
        userId_weekStartDate: {
          userId,
          weekStartDate: normalizedStart,
        },
      },
      create: {
        userId,
        weekStartDate: normalizedStart,
        weekEndDate: normalizedEnd,
        totalSavedCredits: stats.totalSavedCredits,
        tasksCompleted: stats.tasksCompleted,
        highestTier: stats.highestTier,
        streak: stats.streak,
        imageUrl: imageUrl ?? null,
      },
      update: {
        weekEndDate: normalizedEnd,
        totalSavedCredits: stats.totalSavedCredits,
        tasksCompleted: stats.tasksCompleted,
        highestTier: stats.highestTier,
        streak: stats.streak,
        imageUrl: imageUrl ?? undefined,
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Calculate and persist the wrapped record in one call.
   *
   * Convenience method that calls `calculateWeekStats` and then
   * `saveWrappedRecord` atomically.
   *
   * @param userId  The user's ID.
   * @param date    Any date within the target week (defaults to now).
   * @param imageUrl Optional CDN URL of the generated card image.
   * @returns The persisted AcademicWrapped record.
   */
  static async generateAndSave(
    userId: string,
    date: Date = new Date(),
    imageUrl?: string
  ): Promise<AcademicWrapped> {
    const weekStart = getWeekStartDate(date);
    const stats = await this.calculateWeekStats(userId, weekStart);
    return this.saveWrappedRecord(userId, weekStart, stats, imageUrl);
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Fetch all wrapped records for a user, ordered by week DESC.
   *
   * @param userId  The user's ID.
   * @param limit   Maximum number of records to return (default: 10).
   * @returns Array of AcademicWrapped records.
   */
  static async getUserWrappedHistory(
    userId: string,
    limit: number = 10
  ): Promise<AcademicWrapped[]> {
    return baseDb.academicWrapped.findMany({
      where: { userId },
      orderBy: { weekStartDate: "desc" },
      take: limit,
    });
  }
}

// ─── HELPER EXPORTS ──────────────────────────────────────────────────────────

/** Exposed for testing and external use. */
export { getWeekStartDate, getWeekEndDate };

/** Default singleton for ergonomic imports. */
export const academicWrappedService = AcademicWrappedService;
