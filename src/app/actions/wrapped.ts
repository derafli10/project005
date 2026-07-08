"use server";

/**
 * Academic Wrapped Server Actions.
 *
 * Server Actions for fetching wrapped card history and metadata.
 *
 * Requirements: 11.9
 */

import { auth } from "@/auth";
import { academicWrappedService } from "@/lib/services/academic-wrapped.service";
import type { AcademicWrapped } from "@/generated/prisma";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Fetch user's Academic Wrapped history.
 *
 * Returns up to 10 most recent wrapped cards, ordered by week DESC.
 *
 * Requirement: 11.9
 */
export async function getUserWrappedHistoryAction(): Promise<
  ActionResult<AcademicWrapped[]>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const history = await academicWrappedService.getUserWrappedHistory(
      session.user.id,
      10
    );
    return { success: true, data: history };
  } catch (err) {
    console.error("[getUserWrappedHistoryAction]", err);
    return { success: false, error: "Failed to fetch wrapped history" };
  }
}
