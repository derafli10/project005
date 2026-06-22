import { ValidationError } from "@/lib/errors/domain-errors";
import type { Task } from "@/generated/prisma";

/**
 * Priority Score Engine — Just-In-Time evaluation.
 *
 * Priority Scores are computed dynamically in-memory at query time. They are
 * NEVER persisted to the database and NEVER recalculated by a background cron
 * job (Requirements 3.7, 3.8, 3.9).
 *
 * Formula (Requirements 3.1):
 *   score = (sksWeight × 2000 × 0.4) + (taskWeight × 0.4) + (timeUrgency × 0.2)
 *
 * All components are scaled to 0–10000 basis points and use integer arithmetic
 * to avoid floating-point drift (Requirement 3.10).
 *
 * Reference: design.md > Priority Score Engine + Low-Level Design §1.
 */

/** Minimum/maximum bounds for the final priority score (basis points). */
export const MIN_PRIORITY_SCORE = 0;
export const MAX_PRIORITY_SCORE = 10000;

/** SLA breach threshold in hours (Requirement 3.6: < 24h). */
export const SLA_BREACH_HOURS = 24;

/** Upper bound of the exponential-decay window (1–7 days, in hours). */
export const CRITICAL_WINDOW_HOURS = 24 * 7; // 168

/** End of the linear-scale window (beyond this, urgency = 0). */
export const LINEAR_WINDOW_DAYS = 30;

/** Input shape accepted by {@link PriorityEngineService.batchCalculate}. */
export interface PrioritizableTask {
  id: string;
  sksWeight: number;
  taskWeight: number;
  deadlineAt: Date;
}

/** Result of a JIT batch calculation — score lives in memory only. */
export interface TaskWithPriorityScore<T = PrioritizableTask> {
  task: T;
  priorityScore: number;
  timeUrgency: number;
}

export class PriorityEngineService {
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Calculate the time-urgency component (0–10000 basis points) based on the
   * hours remaining until the deadline.
   *
   * Three-tier logic (Requirements 3.4, 3.5, 3.6):
   *   - < 24 h               → 10000 (SLA breach, max urgency)
   *   - 24 h … 168 h (1–7 d) → exponential decay, clamped to [3000, 8000]
   *   - > 168 h (> 7 d)      → linear scale, clamped to [0, 3000] (0 beyond 30 d)
   *
   * @param hoursRemaining Hours until deadline. Negative values (overdue) are
   *   treated as SLA breach.
   */
  static calculateTimeUrgency(hoursRemaining: number): number {
    // Case 1: SLA Breach (< 24 h, or already overdue)
    if (hoursRemaining < SLA_BREACH_HOURS) {
      return 10000;
    }

    const daysRemaining = hoursRemaining / 24;

    // Case 2: Long term (> 7 days) — linear 0–3000 over 7–30 day range
    if (daysRemaining > 7) {
      const normalized = Math.max(0, Math.min(1, (LINEAR_WINDOW_DAYS - daysRemaining) / 23));
      return Math.floor(normalized * 3000);
    }

    // Case 3: Critical window (1–7 days) — exponential decay clamped to [3000, 8000]
    // Formula: 8000 - (daysRemaining^1.5 * 714)
    //   At 7 days → ~3000, at 1 day → ~7286
    const exponentialScore = 8000 - Math.pow(daysRemaining, 1.5) * 714;
    return Math.floor(Math.max(3000, Math.min(8000, exponentialScore)));
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Calculate the full priority score for a task (JIT, in-memory only).
   *
   * @param sksWeight   SKS credit weight, integer 1–5
   * @param taskWeight  Task weight in basis points, 0–10000
   * @param deadlineAt  Task deadline timestamp
   * @param now         Reference timestamp (defaults to `new Date()`). Injected
   *                    for deterministic testing — this is what makes the
   *                    evaluation "Just-In-Time".
   * @returns Integer priority score in [0, 10000]
   * @throws {ValidationError} if sksWeight/taskWeight are out of range or the
   *   deadline is not in the future relative to `now`.
   */
  static calculatePriorityScore(
    sksWeight: number,
    taskWeight: number,
    deadlineAt: Date,
    now: Date = new Date()
  ): number {
    // 1. Validate inputs (Requirement 3.2, 3.3)
    if (!Number.isInteger(sksWeight) || sksWeight < 1 || sksWeight > 5) {
      throw new ValidationError("sksWeight must be an integer between 1 and 5", {
        field: "sksWeight",
        value: sksWeight,
      });
    }
    if (!Number.isInteger(taskWeight) || taskWeight < 0 || taskWeight > 10000) {
      throw new ValidationError("taskWeight must be an integer between 0 and 10000", {
        field: "taskWeight",
        value: taskWeight,
      });
    }
    if (!(deadlineAt instanceof Date) || Number.isNaN(deadlineAt.getTime())) {
      throw new ValidationError("deadlineAt must be a valid Date", {
        field: "deadlineAt",
      });
    }
    if (deadlineAt.getTime() <= now.getTime()) {
      throw new ValidationError("deadline must be in the future", {
        field: "deadlineAt",
        deadlineAt: deadlineAt.toISOString(),
        now: now.toISOString(),
      });
    }

    // 2. Time urgency
    const hoursRemaining = (deadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    const timeUrgency = this.calculateTimeUrgency(hoursRemaining);

    // 3. Normalize SKS weight to 0–10000 scale (SKS 1 → 2000, …, SKS 5 → 10000)
    const sksNormalized = sksWeight * 2000;

    // 4. Apply formula weights (integer math via Math.floor)
    const sksComponent = Math.floor(sksNormalized * 0.4); // 40%
    const taskComponent = Math.floor(taskWeight * 0.4); // 40%
    const timeComponent = Math.floor(timeUrgency * 0.2); // 20%

    // 5. Sum and clamp to [0, 10000]
    const total = sksComponent + taskComponent + timeComponent;
    return Math.min(MAX_PRIORITY_SCORE, Math.max(MIN_PRIORITY_SCORE, total));
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Batch-calculate priority scores for a collection of tasks (JIT, no DB
   * writes). Used by the Task Queue dashboard rendering path.
   *
   * Tasks with a past deadline (relative to `now`) are skipped — they are not
   * rendered in the active queue anyway.
   *
   * @returns Array of `{ task, priorityScore, timeUrgency }` sorted by
   *   priorityScore DESC, then deadlineAt ASC.
   */
  static batchCalculate<T extends PrioritizableTask>(
    tasks: readonly T[],
    now: Date = new Date()
  ): TaskWithPriorityScore<T>[] {
    const scored: TaskWithPriorityScore<T>[] = [];

    for (const task of tasks) {
      // Skip tasks whose deadline is in the past — they cannot be scored.
      if (task.deadlineAt.getTime() <= now.getTime()) continue;

      const hoursRemaining = (task.deadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      const timeUrgency = this.calculateTimeUrgency(hoursRemaining);

      const sksComponent = Math.floor(task.sksWeight * 2000 * 0.4);
      const taskComponent = Math.floor(task.taskWeight * 0.4);
      const timeComponent = Math.floor(timeUrgency * 0.2);
      const total = Math.min(
        MAX_PRIORITY_SCORE,
        Math.max(MIN_PRIORITY_SCORE, sksComponent + taskComponent + timeComponent)
      );

      scored.push({ task, priorityScore: total, timeUrgency });
    }

    // Default order: priorityScore DESC, then deadline ASC (tertiary tiebreaker).
    scored.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      return a.task.deadlineAt.getTime() - b.task.deadlineAt.getTime();
    });

    return scored;
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Generate a human-readable micro-prompt explaining a task's priority
   * (Requirement 4.5).
   *
   * Format: `SKS: {sksWeight} • Bobot: {taskWeight}% • Deadline: {daysRemaining} hari`
   * Appends "🔥 SLA BREACH" when fewer than 24 hours remain (Requirement 4.6).
   */
  static generateMicroPrompt(
    task: Pick<Task, "sksWeight" | "taskWeight" | "deadlineAt">,
    now: Date = new Date()
  ): string {
    const hoursRemaining = (task.deadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    const daysRemaining = Math.max(0, Math.ceil(hoursRemaining / 24));
    const weightPercent = Math.round((task.taskWeight / 10000) * 100);

    const parts = [
      `SKS: ${task.sksWeight}`,
      `Bobot: ${weightPercent}%`,
      `Deadline: ${daysRemaining} hari`,
    ];

    if (hoursRemaining < SLA_BREACH_HOURS) {
      parts.push("🔥 SLA BREACH");
    }

    return parts.join(" • ");
  }
}

/**
 * Default singleton instance for ergonomic imports:
 *   import { priorityEngine } from "@/lib/services/priority-engine.service";
 */
export const priorityEngine = PriorityEngineService;
