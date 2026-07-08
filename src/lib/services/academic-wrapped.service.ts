import "server-only";

import { baseDb } from "@/lib/db";
import type { AcademicWrapped, CookedTier } from "@/generated/prisma";
import type { ReactElement } from "react";

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
 *  - `renderCard` uses @vercel/og (Satori) to generate a 1080×1920 PNG
 *    with gradient background, Poppins/Inter typography, stats, watermark,
 *    and deep link URL (Requirements 11.3, 11.4, 11.5, 11.6).
 *  - `uploadToCDN` pushes the generated PNG buffer to Vercel Blob and
 *    returns a public URL (Requirement 11.7).
 *  - `saveWrappedRecord` upserts an AcademicWrapped record with composite
 *    unique [userId, weekStartDate] (Requirement 11.10).
 *
 * Reference: design.md > Academic Wrapped Service, Requirements 11.1–11.10.
 */

// ─── TYPES ──────────────────────────────────────────────────────────────────

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

/** Human-readable tier labels for the card. */
const TIER_LABEL: Record<CookedTier, string> = {
  MAIN_CHARACTER: "Main Character",
  LET_HIM_COOK: "Let Him Cook",
  SLIGHTLY_COOKED: "Slightly Cooked",
  OVERCOOKED: "Overcooked",
} as const;

/** Tier-specific accent color for the card badge. */
const TIER_COLOR: Record<CookedTier, string> = {
  MAIN_CHARACTER: "#34d399", // emerald-400
  LET_HIM_COOK: "#facc15", // yellow-400
  SLIGHTLY_COOKED: "#fb923c", // orange-400
  OVERCOOKED: "#f87171", // red-400
} as const;

// ─── DATE HELPERS ───────────────────────────────────────────────────────────

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

// ─── FONT LOADING ───────────────────────────────────────────────────────────

/**
 * Lazily loads Google Fonts for Satori rendering.
 * Fetches Poppins (bold, headings) and Inter (regular, body).
 * Cached at module scope so subsequent calls reuse the same buffers.
 */
let fontCache: { poppinsBold: ArrayBuffer; interRegular: ArrayBuffer } | null = null;

async function loadFonts(): Promise<{ poppinsBold: ArrayBuffer; interRegular: ArrayBuffer }> {
  if (fontCache) return fontCache;

  const [poppinsBoldRes, interRegularRes] = await Promise.all([
    fetch(
      "https://fonts.gstatic.com/s/poppins/v22/pxiByp8kv8JHgFVrLCz7V1s.ttf"
    ),
    fetch(
      "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hjQ.ttf"
    ),
  ]);

  if (!poppinsBoldRes.ok || !interRegularRes.ok) {
    throw new Error("Failed to fetch fonts for Academic Wrapped card rendering");
  }

  fontCache = {
    poppinsBold: await poppinsBoldRes.arrayBuffer(),
    interRegular: await interRegularRes.arrayBuffer(),
  };

  return fontCache;
}

// ─── SERVICE CLASS ──────────────────────────────────────────────────────────

export class AcademicWrappedService {
  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Render the Academic Wrapped card as a 1080×1920 PNG using @vercel/og
   * (Satori JSX-to-image pipeline). No native binaries required — fully
   * compatible with Lambda/Vercel serverless environments.
   *
   * Card layout (top to bottom):
   *  - App branding header ("Project005")
   *  - Week date range
   *  - Hero stat: total saved credits %
   *  - Stats grid: tasks completed, streak, highest tier
   *  - Day activity dots (streak visualisation)
   *  - Watermark + deep link URL footer
   *
   * Requirements: 11.3, 11.4, 11.5, 11.6
   *
   * @param stats     Computed weekly statistics.
   * @param userName  Display name for the card.
   * @param weekStart Monday of the target week (used for date range label).
   * @returns PNG image as a Buffer.
   */
  static async renderCard(
    stats: WeekStats,
    userName: string,
    weekStart: Date
  ): Promise<Buffer> {
    // Dynamic import to keep @vercel/og out of unrelated bundles
    const { ImageResponse } = await import("@vercel/og");

    const fonts = await loadFonts();

    const weekEnd = getWeekEndDate(weekStart);
    const dateRange = `${formatDate(weekStart)} – ${formatDate(weekEnd)}`;
    const savedPercent = (stats.totalSavedCredits / 100).toFixed(1);
    const tierLabel = TIER_LABEL[stats.highestTier];
    const tierColor = TIER_COLOR[stats.highestTier];
    const deepLinkUrl = "project005.app/wrapped";

    // ── Build the JSX tree (React-like, rendered by Satori) ──────────
    const element: ReactElement = {
      key: null,
      type: "div" as const,
      props: {
        style: {
          display: "flex",
          flexDirection: "column" as const,
          alignItems: "center" as const,
          justifyContent: "space-between" as const,
          width: "100%",
          height: "100%",
          padding: "80px 60px",
          background:
            "linear-gradient(160deg, #0f0c29 0%, #302b63 40%, #24243e 70%, #0f0c29 100%)",
          fontFamily: "Inter",
          color: "#ffffff",
        },
        children: [
          // ── Top: Branding header ──────────────────────────────────
          {
            type: "div" as const,
            props: {
              style: {
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center" as const,
                gap: "12px",
              },
              children: [
                {
                  type: "div" as const,
                  props: {
                    style: {
                      display: "flex",
                      alignItems: "center" as const,
                      gap: "16px",
                    },
                    children: [
                      // Logo mark
                      {
                        type: "div" as const,
                        props: {
                          style: {
                            width: "48px",
                            height: "48px",
                            borderRadius: "12px",
                            background:
                              "linear-gradient(135deg, #a78bfa, #818cf8)",
                            display: "flex",
                            alignItems: "center" as const,
                            justifyContent: "center" as const,
                            fontSize: "24px",
                            fontFamily: "Poppins",
                            fontWeight: 700,
                          },
                          children: "P",
                        },
                      },
                      {
                        type: "div" as const,
                        props: {
                          style: {
                            fontSize: "36px",
                            fontFamily: "Poppins",
                            fontWeight: 700,
                            letterSpacing: "-0.5px",
                          },
                          children: "Project005",
                        },
                      },
                    ],
                  },
                },
                {
                  type: "div" as const,
                  props: {
                    style: {
                      fontSize: "20px",
                      opacity: 0.6,
                      letterSpacing: "4px",
                      textTransform: "uppercase" as const,
                    },
                    children: "ACADEMIC WRAPPED",
                  },
                },
              ],
            },
          },

          // ── Middle: Week range + User name ────────────────────────
          {
            type: "div" as const,
            props: {
              style: {
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center" as const,
                gap: "8px",
              },
              children: [
                {
                  type: "div" as const,
                  props: {
                    style: {
                      fontSize: "22px",
                      opacity: 0.5,
                    },
                    children: dateRange,
                  },
                },
                {
                  type: "div" as const,
                  props: {
                    style: {
                      fontSize: "32px",
                      fontFamily: "Poppins",
                      fontWeight: 700,
                    },
                    children: userName,
                  },
                },
              ],
            },
          },

          // ── Hero stat: Saved credits ──────────────────────────────
          {
            type: "div" as const,
            props: {
              style: {
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center" as const,
                gap: "8px",
              },
              children: [
                {
                  type: "div" as const,
                  props: {
                    style: {
                      fontSize: "120px",
                      fontFamily: "Poppins",
                      fontWeight: 700,
                      lineHeight: 1,
                      background:
                        "linear-gradient(135deg, #c084fc, #818cf8, #38bdf8)",
                      backgroundClip: "text",
                      color: "transparent",
                    },
                    children: `${savedPercent}%`,
                  },
                },
                {
                  type: "div" as const,
                  props: {
                    style: {
                      fontSize: "24px",
                      opacity: 0.7,
                      letterSpacing: "2px",
                      textTransform: "uppercase" as const,
                    },
                    children: "CREDITS SAVED",
                  },
                },
              ],
            },
          },

          // ── Stats grid: 3 cards ───────────────────────────────────
          {
            type: "div" as const,
            props: {
              style: {
                display: "flex",
                gap: "24px",
                width: "100%",
                justifyContent: "center" as const,
              },
              children: [
                // Tasks completed
                buildStatCard(
                  String(stats.tasksCompleted),
                  "Tasks Done",
                  "#818cf8"
                ),
                // Streak
                buildStatCard(
                  `${stats.streak} day${stats.streak !== 1 ? "s" : ""}`,
                  "Best Streak",
                  "#38bdf8"
                ),
                // Highest tier badge
                buildStatCard(tierLabel, "Peak Tier", tierColor),
              ],
            },
          },

          // ── Streak day dots ───────────────────────────────────────
          {
            type: "div" as const,
            props: {
              style: {
                display: "flex",
                gap: "16px",
                alignItems: "center" as const,
              },
              children: ["M", "T", "W", "T", "F", "S", "S"].map(
                (label, i) => ({
                  type: "div" as const,
                  props: {
                    style: {
                      display: "flex",
                      flexDirection: "column" as const,
                      alignItems: "center" as const,
                      gap: "8px",
                    },
                    children: [
                      {
                        type: "div" as const,
                        props: {
                          style: {
                            width: "40px",
                            height: "40px",
                            borderRadius: "50%",
                            background:
                              i < stats.streak
                                ? "linear-gradient(135deg, #a78bfa, #818cf8)"
                                : "rgba(255,255,255,0.1)",
                            border:
                              i < stats.streak
                                ? "none"
                                : "2px solid rgba(255,255,255,0.15)",
                            display: "flex",
                            alignItems: "center" as const,
                            justifyContent: "center" as const,
                          },
                          children:
                            i < stats.streak
                              ? {
                                  type: "div" as const,
                                  props: {
                                    style: {
                                      fontSize: "18px",
                                    },
                                    children: "✓",
                                  },
                                }
                              : null,
                        },
                      },
                      {
                        type: "div" as const,
                        props: {
                          style: {
                            fontSize: "14px",
                            opacity: 0.5,
                          },
                          children: label,
                        },
                      },
                    ],
                  },
                })
              ),
            },
          },

          // ── Footer: Watermark + deep link ─────────────────────────
          {
            type: "div" as const,
            props: {
              style: {
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center" as const,
                gap: "12px",
                opacity: 0.5,
              },
              children: [
                {
                  type: "div" as const,
                  props: {
                    style: {
                      width: "600px",
                      height: "1px",
                      background:
                        "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
                    },
                    children: [],
                  },
                },
                {
                  type: "div" as const,
                  props: {
                    style: {
                      fontSize: "18px",
                      letterSpacing: "1px",
                    },
                    children: "Generated by Project005",
                  },
                },
                {
                  type: "div" as const,
                  props: {
                    style: {
                      fontSize: "16px",
                      opacity: 0.7,
                    },
                    children: deepLinkUrl,
                  },
                },
              ],
            },
          },
        ],
      },
    };

    // ── Render via @vercel/og (Satori → resvg-wasm → PNG) ───────────
    const response = new ImageResponse(element, {
      width: 1080,
      height: 1920,
      fonts: [
        {
          name: "Poppins",
          data: fonts.poppinsBold,
          weight: 700 as const,
          style: "normal" as const,
        },
        {
          name: "Inter",
          data: fonts.interRegular,
          weight: 400 as const,
          style: "normal" as const,
        },
      ],
    });

    // Convert ReadableStream<Uint8Array> → Node Buffer
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Upload the generated PNG card to Vercel Blob CDN.
   *
   * Uses a deterministic pathname so re-uploads for the same user+week
   * overwrite the previous blob, keeping immutable cache semantics.
   *
   * Requirement: 11.7
   *
   * @param imageBuffer  PNG image data.
   * @param userId       User ID (used in the blob path).
   * @param weekDate     Monday of the target week (used in the blob path).
   * @returns Public CDN URL of the uploaded image.
   */
  static async uploadToCDN(
    imageBuffer: Buffer,
    userId: string,
    weekDate: Date
  ): Promise<string> {
    const { put } = await import("@vercel/blob");

    const weekKey = weekDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const pathname = `wrapped/${userId}/${weekKey}.png`;

    const blob = await put(pathname, imageBuffer, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
    });

    return blob.url;
  }

  // ─────────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Full end-to-end pipeline: calculate stats → render card → upload to
   * CDN → save wrapped record.
   *
   * Orchestrates all four steps of the Academic Wrapped generation flow.
   *
   * @param userId    The user's ID.
   * @param userName  Display name for the card.
   * @param date      Any date within the target week (defaults to now).
   * @returns The persisted AcademicWrapped record with imageUrl populated.
   */
  static async generateAndSave(
    userId: string,
    userName: string = "Student",
    date: Date = new Date()
  ): Promise<AcademicWrapped> {
    const weekStart = getWeekStartDate(date);

    // Step 1: Calculate weekly stats
    const stats = await this.calculateWeekStats(userId, weekStart);

    // Step 2: Render the card as PNG using @vercel/og (Satori)
    const imageBuffer = await this.renderCard(stats, userName, weekStart);

    // Step 3: Upload to Vercel Blob CDN
    const imageUrl = await this.uploadToCDN(imageBuffer, userId, weekStart);

    // Step 4: Persist the wrapped record
    return this.saveWrappedRecord(userId, weekStart, stats, imageUrl);
  }

  // ─────────────────────────────────────────────────────────────────────────
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

// ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────

/**
 * Builds a stat card element for the Satori JSX tree.
 * Renders as a frosted-glass pill with value + label.
 */
function buildStatCard(
  value: string,
  label: string,
  accentColor: string
): {
  type: "div";
  props: {
    style: Record<string, unknown>;
    children: Array<{ type: "div"; props: { style: Record<string, unknown>; children: string } }>;
  };
} {
  return {
    type: "div" as const,
    props: {
      style: {
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center" as const,
        gap: "8px",
        background: "rgba(255,255,255,0.06)",
        borderRadius: "24px",
        padding: "28px 36px",
        border: "1px solid rgba(255,255,255,0.08)",
        minWidth: "240px",
      },
      children: [
        {
          type: "div" as const,
          props: {
            style: {
              fontSize: "36px",
              fontFamily: "Poppins",
              fontWeight: 700,
              color: accentColor,
            },
            children: value,
          },
        },
        {
          type: "div" as const,
          props: {
            style: {
              fontSize: "18px",
              opacity: 0.6,
              textTransform: "uppercase" as const,
              letterSpacing: "2px",
            },
            children: label,
          },
        },
      ],
    },
  };
}

/**
 * Format a Date as "Mon DD" (e.g. "Jul 07").
 */
function formatDate(date: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month} ${day}`;
}

// ─── HELPER EXPORTS ──────────────────────────────────────────────────────────

/** Exposed for testing and external use. */
export { getWeekStartDate, getWeekEndDate };

/** Default singleton for ergonomic imports. */
export const academicWrappedService = AcademicWrappedService;
