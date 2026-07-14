import "server-only";

import { cache } from "react";
import { baseDb } from "@/lib/db";
import type { ClassRoom, ClassRoomMember } from "@/generated/prisma";

/**
 * React Server Component caching for classroom data.
 *
 * Uses React's `cache()` to deduplicate identical requests within a single
 * RSC render pass. This prevents redundant database queries when multiple
 * components in the same server render tree need the same classroom data.
 *
 * React `cache()` is scoped to a single server request — it does NOT persist
 * across requests (unlike `unstable_cache` / Next.js Data Cache). This is the
 * correct choice for user-specific data that changes frequently.
 *
 * Reference: Task 21.2 — Add React Server Component caching for static data.
 */

/**
 * Fetch a user's classroom memberships with classroom details.
 * Deduplicated per request via React `cache()`.
 */
export const getCachedUserClassrooms = cache(
  async (
    userId: string
  ): Promise<(ClassRoomMember & { classRoom: ClassRoom })[]> => {
    return baseDb.classRoomMember.findMany({
      where: { userId },
      include: { classRoom: true },
      orderBy: { joinedAt: "desc" },
    });
  }
);

/**
 * Fetch a single classroom by ID.
 * Deduplicated per request via React `cache()`.
 */
export const getCachedClassroom = cache(
  async (classRoomId: string): Promise<ClassRoom | null> => {
    return baseDb.classRoom.findUnique({
      where: { id: classRoomId },
    });
  }
);

/**
 * Fetch a classroom by its classCode.
 * Deduplicated per request via React `cache()`.
 */
export const getCachedClassroomByCode = cache(
  async (classCode: string): Promise<ClassRoom | null> => {
    return baseDb.classRoom.findUnique({
      where: { classCode },
    });
  }
);

/**
 * Fetch classroom member count.
 * Deduplicated per request via React `cache()`.
 */
export const getCachedClassroomMemberCount = cache(
  async (classRoomId: string): Promise<number> => {
    return baseDb.classRoomMember.count({
      where: { classRoomId },
    });
  }
);
