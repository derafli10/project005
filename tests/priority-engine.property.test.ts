import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  PriorityEngineService,
  MIN_PRIORITY_SCORE,
  MAX_PRIORITY_SCORE,
  SLA_BREACH_HOURS,
  CRITICAL_WINDOW_HOURS,
} from "@/lib/services/priority-engine.service";
import { ValidationError } from "@/lib/errors/domain-errors";

/**
 * Property-based tests for the Priority Score Engine.
 *
 * @tags Feature: project005-task-management-dss, Property 7, Property 8
 *
 * Reference: design.md > Correctness Properties 7 & 8, Requirements 3.1–3.7.
 */

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Random SKS weight, integer 1–5 (Requirement 3.2). */
const sksWeightArb = fc.integer({ min: 1, max: 5 });

/** Random task weight, integer 0–10000 basis points (Requirement 3.3). */
const taskWeightArb = fc.integer({ min: 0, max: 10000 });

/** Fixed "now" anchor; deadlines are generated relative to it. */
const NOW = new Date("2026-01-15T12:00:00Z");
const MS_PER_HOUR = 1000 * 60 * 60;

/** Deadline strictly in the future: 1 hour … 60 days away. */
const futureDeadlineArb = fc
  .integer({ min: 1, max: 60 * 24 })
  .map((hoursAhead) => new Date(NOW.getTime() + hoursAhead * MS_PER_HOUR));

/** Deadline < 24 h away (SLA breach bucket). */
const slaDeadlineArb = fc
  .integer({ min: 1, max: SLA_BREACH_HOURS - 1 })
  .map((hours) => new Date(NOW.getTime() + hours * MS_PER_HOUR));

/** Deadline 24 h … 168 h (1–7 days, exponential decay bucket). */
const criticalDeadlineArb = fc
  .integer({ min: SLA_BREACH_HOURS, max: CRITICAL_WINDOW_HOURS })
  .map((hours) => new Date(NOW.getTime() + hours * MS_PER_HOUR));

/** Deadline > 168 h (> 7 days, linear bucket). */
const longDeadlineArb = fc
  .integer({ min: CRITICAL_WINDOW_HOURS + 1, max: 60 * 24 })
  .map((hours) => new Date(NOW.getTime() + hours * MS_PER_HOUR));

// ─── Property 7: Priority Score Calculation Formula Correctness ────────────

describe("Property 7: Priority Score Calculation Formula Correctness", () => {
  it("matches the formula (sksWeight × 2000 × 0.4) + (taskWeight × 0.4) + (timeUrgency × 0.2), clamped to [0, 10000]", () => {
    fc.assert(
      fc.property(
        sksWeightArb,
        taskWeightArb,
        futureDeadlineArb,
        (sksWeight, taskWeight, deadlineAt) => {
          const score = PriorityEngineService.calculatePriorityScore(
            sksWeight,
            taskWeight,
            deadlineAt,
            NOW
          );

          // Recompute the expected value independently.
          const hoursRemaining =
            (deadlineAt.getTime() - NOW.getTime()) / MS_PER_HOUR;
          const timeUrgency =
            PriorityEngineService.calculateTimeUrgency(hoursRemaining);

          const sksComponent = Math.floor(sksWeight * 2000 * 0.4);
          const taskComponent = Math.floor(taskWeight * 0.4);
          const timeComponent = Math.floor(timeUrgency * 0.2);
          const raw = sksComponent + taskComponent + timeComponent;
          const expected = Math.min(
            MAX_PRIORITY_SCORE,
            Math.max(MIN_PRIORITY_SCORE, raw)
          );

          expect(score).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("always returns an integer within [0, 10000]", () => {
    fc.assert(
      fc.property(
        sksWeightArb,
        taskWeightArb,
        futureDeadlineArb,
        (sksWeight, taskWeight, deadlineAt) => {
          const score = PriorityEngineService.calculatePriorityScore(
            sksWeight,
            taskWeight,
            deadlineAt,
            NOW
          );
          expect(Number.isInteger(score)).toBe(true);
          expect(score).toBeGreaterThanOrEqual(MIN_PRIORITY_SCORE);
          expect(score).toBeLessThanOrEqual(MAX_PRIORITY_SCORE);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects out-of-range sksWeight with ValidationError", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 0 }), (badSks) => {
        expect(() =>
          PriorityEngineService.calculatePriorityScore(
            badSks,
            5000,
            new Date(NOW.getTime() + 48 * MS_PER_HOUR),
            NOW
          )
        ).toThrow(ValidationError);
      })
    );
    fc.assert(
      fc.property(fc.integer({ min: 6, max: 100 }), (badSks) => {
        expect(() =>
          PriorityEngineService.calculatePriorityScore(
            badSks,
            5000,
            new Date(NOW.getTime() + 48 * MS_PER_HOUR),
            NOW
          )
        ).toThrow(ValidationError);
      })
    );
  });

  it("rejects out-of-range taskWeight with ValidationError", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: -1 }), (badWeight) => {
        expect(() =>
          PriorityEngineService.calculatePriorityScore(
            3,
            badWeight,
            new Date(NOW.getTime() + 48 * MS_PER_HOUR),
            NOW
          )
        ).toThrow(ValidationError);
      })
    );
    fc.assert(
      fc.property(fc.integer({ min: 10001, max: 100000 }), (badWeight) => {
        expect(() =>
          PriorityEngineService.calculatePriorityScore(
            3,
            badWeight,
            new Date(NOW.getTime() + 48 * MS_PER_HOUR),
            NOW
          )
        ).toThrow(ValidationError);
      })
    );
  });

  it("rejects a deadline in the past with ValidationError", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (msAgo) => {
        const past = new Date(NOW.getTime() - msAgo);
        expect(() =>
          PriorityEngineService.calculatePriorityScore(3, 5000, past, NOW)
        ).toThrow(ValidationError);
      })
    );
  });
});

// ─── Property 8: Time Urgency Calculation by Deadline Range ────────────────

describe("Property 8: Time Urgency Calculation by Deadline Range", () => {
  it("returns 10000 for SLA breach (< 24 h, including overdue)", () => {
    fc.assert(
      fc.property(slaDeadlineArb, (deadline) => {
        const hours = (deadline.getTime() - NOW.getTime()) / MS_PER_HOUR;
        const urgency = PriorityEngineService.calculateTimeUrgency(hours);
        expect(urgency).toBe(10000);
      }),
      { numRuns: 100 }
    );
    // Overdue edge case.
    expect(
      PriorityEngineService.calculateTimeUrgency(-5)
    ).toBe(10000);
    // Exactly 23h boundary.
    expect(
      PriorityEngineService.calculateTimeUrgency(23.99)
    ).toBe(10000);
  });

  it("returns a value in [3000, 8000] for the 1–7 day exponential-decay window", () => {
    fc.assert(
      fc.property(criticalDeadlineArb, (deadline) => {
        const hours = (deadline.getTime() - NOW.getTime()) / MS_PER_HOUR;
        const urgency = PriorityEngineService.calculateTimeUrgency(hours);
        expect(urgency).toBeGreaterThanOrEqual(3000);
        expect(urgency).toBeLessThanOrEqual(8000);
        // Should always be an integer.
        expect(Number.isInteger(urgency)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("returns a value in [0, 3000] for the > 7 day linear window", () => {
    fc.assert(
      fc.property(longDeadlineArb, (deadline) => {
        const hours = (deadline.getTime() - NOW.getTime()) / MS_PER_HOUR;
        const urgency = PriorityEngineService.calculateTimeUrgency(hours);
        expect(urgency).toBeGreaterThanOrEqual(0);
        expect(urgency).toBeLessThanOrEqual(3000);
        expect(Number.isInteger(urgency)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it("returns 0 urgency for deadlines beyond 30 days", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 31 * 24, max: 365 * 24 }),
        (hoursAhead) => {
          const urgency =
            PriorityEngineService.calculateTimeUrgency(hoursAhead);
          expect(urgency).toBe(0);
        }
      )
    );
  });

  it("monotonically increases as the deadline approaches (within the critical window)", () => {
    // For any two points a < b in the critical window, urgency(a) >= urgency(b)
    // because urgency grows as deadline nears.
    fc.assert(
      fc.property(
        fc.record({
          innerHours: fc.integer({ min: SLA_BREACH_HOURS, max: CRITICAL_WINDOW_HOURS - 1 }),
          outerHours: fc.integer({ min: SLA_BREACH_HOURS, max: CRITICAL_WINDOW_HOURS - 1 }),
        }),
        ({ innerHours, outerHours }) => {
          fc.pre(innerHours < outerHours);
          const inner = PriorityEngineService.calculateTimeUrgency(innerHours);
          const outer = PriorityEngineService.calculateTimeUrgency(outerHours);
          expect(inner).toBeGreaterThanOrEqual(outer);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── batchCalculate sorting sanity ──────────────────────────────────────────

describe("PriorityEngineService.batchCalculate", () => {
  it("sorts by priorityScore DESC then deadlineAt ASC", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 10 }),
            sksWeight: sksWeightArb,
            taskWeight: taskWeightArb,
            deadlineAt: futureDeadlineArb,
          }),
          { minLength: 0, maxLength: 30 }
        ),
        (tasks) => {
          const scored = PriorityEngineService.batchCalculate(tasks, NOW);
          for (let i = 1; i < scored.length; i++) {
            const prev = scored[i - 1]!;
            const curr = scored[i]!;
            if (prev.priorityScore === curr.priorityScore) {
              expect(prev.task.deadlineAt.getTime()).toBeLessThanOrEqual(
                curr.task.deadlineAt.getTime()
              );
            } else {
              expect(prev.priorityScore).toBeGreaterThan(curr.priorityScore);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
