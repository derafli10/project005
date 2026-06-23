import "server-only";

import { baseDb } from "@/lib/db";
import {
  PriorityEngineService,
  type PrioritizableTask,
} from "./priority-engine.service";
import { determineCookedTier } from "./task.service";
import type { CookedScore, CookedTier } from "@/generated/prisma";

/**
 * Cooked Meter Service
 *
 * Calculates and tracks user stress levels based on upcoming Parent Task load
 * (excluding SubTasks). Provides real-time tier classification, sparkline
 * history, daily snapshot persistence, and Recovery Mode offer evaluation.
 *
 * Key behaviors:
 *  - `calculateCumulativeScore` sums JIT-computed Priority_Score of PARENT
 *    Tasks ONLY (isSubTask=false) with deadline in the next 7 days via the
 *    UserTaskProgress relationship. SubTasks are excluded to prevent
 *    exponential stress inflation (Requirement 7.8).
 *  - `determineTier` maps cumulative scores to the CookedTier enum
 *    (Requirement 6.3–6.6).
 *  - `getSparklineData` fetches the last 7 daily CookedScore snapshots
 *    (Requirement 6.7).
 *  - `saveDailySnapshot` upserts a CookedScore record for today using the
 *    composite unique [userId, date] constraint (Requirement 6.8).
 *  - `shouldOfferRecoveryMode` returns true when cumulativeScore > 8000
 *    (Requirement 7.1). Does NOT auto-activate — UI gatekeeping only.
 *
 * Reference: design.md > Cooked Meter Service, Requirements 6.1–6.8, 7.1.
 */

/** Recovery Mode offer threshold in basis points (> 80% scale). */
const RECOVERY_MODE_THRESHOLD = 8000;

/** Number of days in the upcoming task window for cumulative score. */
const UPCOMING_WINDOW_DAYS = 7;

/** Number of days of sparkline history to fetch. */
const SPARKLINE_HISTORY_DAYS = 7;

/** Shape returned by {@link CookedMeterService.getSparklineData}. */
export interface SparklineDataPoint {
  date: Date;
  score: number;
  tier: CookedTier;
}

/** Full meter state returned by {@link CookedMeterService.getMeterState}. */
export interface CookedMeterState {
  cumulativeScore: number;
  tier: CookedTier;
  shouldOfferRecovery: boolean;
  sparklineData: SparklineDataPoint[];
}

export class CookedMeterService {
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Calculate the current cumulative stress score for a user.
   *
   * Sums JIT-computed Priority_Score of Parent Tasks ONLY (isSubTask=false)
   * with deadline in the next 7 days via the UserTaskProgress relationship.
   * SubTasks are explicitly excluded to prevent exponential stress inflation
   * (Requirement 7.8).
   *
   * Requirements 6.1, 6.2.
   *
   * @param userId  The user whose cumulative score to calculate.
   * @param now     Reference timestamp (injectable for testing).
   * @returns Cumulative score in basis points (0–10000+). Can exceed 10000
   *   when a user has many high-priority tasks.
   */
  static async calculateCumulativeScore(
    userId: string,
    now: Date = new Date()
  ): Promise<number> {
    // 1. Calculate the 7-day deadline window.
    const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // 2. Fetch non-completed Parent Tasks with deadline in the next 7 days
    //    that the user has a UserTaskProgress bridge row for.
    //    Use explicit `select` to minimize over-fetching per backend architect rules.
    const progressRows = await baseDb.userTaskProgress.findMany({
      where: {
        userId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        task: {
          isSubTask: false,
          deadlineAt: {
            gt: now,
            lte: windowEnd,
          },
        },
      },
      select: {
        task: {
          select: {
            id: true,
            sksWeight: true,
            taskWeight: true,
            deadlineAt: true,
          },
        },
      },
    });

    // 3. Extract the prioritizable task data.
    const parentTasks: PrioritizableTask[] = progressRows.map((row) => ({
      id: row.task.id,
      sksWeight: row.task.sksWeight,
      taskWeight: row.task.taskWeight,
      deadlineAt: row.task.deadlineAt,
    }));

    // 4. If there are no qualifying tasks, score is 0.
    if (parentTasks.length === 0) {
      return 0;
    }

    // 5. Compute JIT priority scores via the Priority Engine (in-memory only).
    const scored = PriorityEngineService.batchCalculate(parentTasks, now);

    // 6. Sum all priority scores (cumulative — can exceed 10000).
    return scored.reduce((sum, entry) => sum + entry.priorityScore, 0);
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Determine the stress tier based on a cumulative score.
   *
   * Delegates to the shared `determineCookedTier` function (also used by
   * TaskService.completeTask for Academic Comeback detection).
   *
   * Score ranges (Requirements 6.3–6.6):
   *   0–2000:  MAIN_CHARACTER
   *   2001–5000: LET_HIM_COOK
   *   5001–8000: SLIGHTLY_COOKED
   *   > 8000:  OVERCOOKED
   *
   * @param cumulativeScore  The cumulative score in basis points.
   * @returns The CookedTier enum value.
   */
  static determineTier(cumulativeScore: number): CookedTier {
    return determineCookedTier(cumulativeScore);
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Get the 7-day sparkline data for a user.
   *
   * Fetches CookedScore records for the last 7 days, ordered by date ASC.
   * Returns an array of `{ date, score, tier }` data points for rendering
   * the sparkline chart (Requirement 6.7).
   *
   * @param userId  The user whose sparkline data to fetch.
   * @param now     Reference timestamp (injectable for testing).
   * @returns Array of sparkline data points (may be < 7 if snapshots are missing).
   */
  static async getSparklineData(
    userId: string,
    now: Date = new Date()
  ): Promise<SparklineDataPoint[]> {
    // Calculate the start of the 7-day window (midnight UTC, 7 days ago).
    const windowStart = new Date(now);
    windowStart.setUTCDate(windowStart.getUTCDate() - SPARKLINE_HISTORY_DAYS);
    windowStart.setUTCHours(0, 0, 0, 0);

    const records = await baseDb.cookedScore.findMany({
      where: {
        userId,
        date: {
          gte: windowStart,
          lte: now,
        },
      },
      select: {
        date: true,
        cumulativeScore: true,
        tier: true,
      },
      orderBy: {
        date: "asc",
      },
    });

    return records.map((record) => ({
      date: record.date,
      score: record.cumulativeScore,
      tier: record.tier,
    }));
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Save (upsert) a daily cooked score snapshot for the user.
   *
   * Called by daily cron job or on-demand when the user checks their meter.
   * Uses the composite unique [userId, date] constraint to ensure exactly
   * one snapshot per user per day (Requirement 6.8).
   *
   * @param userId  The user whose daily snapshot to save.
   * @param now     Reference timestamp (injectable for testing).
   * @returns The created or updated CookedScore record.
   */
  static async saveDailySnapshot(
    userId: string,
    now: Date = new Date()
  ): Promise<CookedScore> {
    // 1. Calculate the current cumulative score.
    const cumulativeScore = await this.calculateCumulativeScore(userId, now);

    // 2. Determine the tier from the score.
    const tier = this.determineTier(cumulativeScore);

    // 3. Normalize today's date to midnight UTC for the composite unique key.
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // 4. Upsert — create if not exists, update if today's record already exists.
    return baseDb.cookedScore.upsert({
      where: {
        userId_date: { userId, date: today },
      },
      create: {
        userId,
        date: today,
        cumulativeScore,
        tier,
      },
      update: {
        cumulativeScore,
        tier,
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Check if the Recovery Mode UI modal should be displayed to the user.
   *
   * Returns true when the user's current cumulative score exceeds the
   * OVERCOOKED threshold (8000 basis points). This does NOT auto-activate
   * Recovery Mode — it merely triggers the UI modal so the user can
   * explicitly consent (Requirement 7.1).
   *
   * @param userId  The user to check.
   * @param now     Reference timestamp (injectable for testing).
   * @returns True if the Recovery Mode offer should be displayed.
   */
  static async shouldOfferRecoveryMode(
    userId: string,
    now: Date = new Date()
  ): Promise<boolean> {
    const cumulativeScore = await this.calculateCumulativeScore(userId, now);
    return cumulativeScore > RECOVERY_MODE_THRESHOLD;
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Get the full meter state for a user in a single call.
   *
   * Combines `calculateCumulativeScore`, `determineTier`, `shouldOfferRecoveryMode`,
   * and `getSparklineData` into one consolidated payload for the dashboard
   * (Requirement 6.1, 6.10). Avoids redundant score calculations by computing
   * the score once and deriving all other values from it.
   *
   * @param userId  The user whose meter state to fetch.
   * @param now     Reference timestamp (injectable for testing).
   * @returns Complete meter state object.
   */
  static async getMeterState(
    userId: string,
    now: Date = new Date()
  ): Promise<CookedMeterState> {
    // Single score calculation — reuse for tier and recovery check.
    const cumulativeScore = await this.calculateCumulativeScore(userId, now);
    const tier = this.determineTier(cumulativeScore);
    const shouldOfferRecovery = cumulativeScore > RECOVERY_MODE_THRESHOLD;
    const sparklineData = await this.getSparklineData(userId, now);

    return {
      cumulativeScore,
      tier,
      shouldOfferRecovery,
      sparklineData,
    };
  }
}

/** Default singleton for ergonomic imports. */
export const cookedMeterService = CookedMeterService;
