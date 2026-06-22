import "server-only";

import { baseDb } from "@/lib/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import { ClassRoomCreateSchema, classCodeSchema } from "@/lib/validation/schemas";
import type { ClassRoom, ClassRoomMember } from "@/generated/prisma";
import { nanoid, customAlphabet } from "nanoid";

/**
 * ClassRoom Service
 *
 * Manages classroom creation, membership, and task propagation via the
 * Many-to-Many bridge pattern (UserTaskProgress).
 *
 * Key behaviours:
 *  - `generateClassCode` produces an 8-character code from a safe alphabet
 *    that excludes visually ambiguous characters (0O, 1Il). Requirement 8.1.
 *  - `createClassRoom` wraps code generation with collision retry (max 5).
 *    Requirements 8.1, 8.2.
 *  - `joinClassRoom` creates a ClassRoomMember record with role MEMBER and
 *    adds UserTaskProgress bridge rows for all existing classroom tasks so
 *    the new member immediately sees shared tasks. Requirements 8.4, 8.5, 8.7.
 *  - `leaveClassRoom` deletes ONLY UserTaskProgress records associated with
 *    Tasks belonging to that classroom — preserving global Task integrity.
 *    Requirement 8.10.
 *  - `getUserClassRooms` fetches all classrooms a user belongs to.
 *    Requirement 8.6.
 *
 * Tenant isolation: All operations use `baseDb` (un-scoped) because classroom
 * operations are inherently cross-tenant (creating bridge rows for multiple
 * users, looking up classrooms by code, etc.).
 *
 * Reference: design.md > ClassRoom Service, Requirements 8.1–8.10.
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

/**
 * Safe alphabet for class codes.
 * Excludes visually ambiguous characters: 0, O, 1, I, l.
 * Per Requirements 8.1 and design.md constraint #4.
 */
const CLASS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Class codes are exactly 8 characters. */
const CLASS_CODE_LENGTH = 8;

/** Maximum retry attempts for class code collision. */
const MAX_CODE_RETRIES = 5;

/** Generate an 8-character class code using the safe alphabet. */
const generateCode = customAlphabet(CLASS_CODE_ALPHABET, CLASS_CODE_LENGTH);

// ─── TYPES ──────────────────────────────────────────────────────────────────

/** Result of {@link ClassRoomService.getUserClassRooms}. */
export interface ClassRoomWithMembership {
  classRoom: ClassRoom;
  membership: {
    userId: string;
    classRoomId: string;
    joinedAt: Date;
  };
}

/** Result of {@link ClassRoomService.joinClassRoom}. */
export interface JoinClassRoomResult {
  membership: ClassRoomMember;
  classRoom: ClassRoom;
  /** Number of existing tasks that were propagated to the new member. */
  tasksAdded: number;
}

// ─── SERVICE ────────────────────────────────────────────────────────────────

export class ClassRoomService {
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Generate a unique 8-character alphanumeric class code.
   *
   * Uses nanoid with a custom alphabet that excludes visually ambiguous
   * characters (0O, 1Il). The code is always uppercase.
   *
   * Requirement 8.1: Class_Code unik 8 karakter alphanumeric.
   */
  static generateClassCode(): string {
    return generateCode();
  }

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Create a new classroom with a unique 8-character code.
   *
   * Retries up to {@link MAX_CODE_RETRIES} times if a code collision occurs
   * (extremely unlikely given the 32^8 ≈ 1.1 trillion keyspace, but
   * required by the task spec for correctness).
   *
   * The creator is automatically added as a member with ADMIN-like status
   * (they are the `creatorId` on the ClassRoom record).
   *
   * Requirements 8.1, 8.2, 8.3.
   *
   * @param name      Classroom name (2–120 characters).
   * @param ownerId   The user creating the classroom.
   * @param sksWeight SKS credit weight for this class (1–5 integer).
   * @returns The created ClassRoom record.
   * @throws {ValidationError}  If inputs fail Zod validation.
   * @throws {ConflictError}    If code generation fails after max retries.
   */
  static async createClassRoom(
    name: string,
    ownerId: string,
    sksWeight: number
  ): Promise<ClassRoom> {
    // 1. Validate inputs via Zod schema.
    const parsed = ClassRoomCreateSchema.safeParse({ name, sksWeight });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new ValidationError(
        firstIssue?.message ?? "Invalid classroom input",
        { field: String(firstIssue?.path[0] ?? "unknown") }
      );
    }

    // 2. Generate a unique code with collision retry.
    let classCode: string | null = null;
    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
      const candidate = this.generateClassCode();
      const existing = await baseDb.classRoom.findUnique({
        where: { classCode: candidate },
        select: { id: true },
      });
      if (!existing) {
        classCode = candidate;
        break;
      }
    }

    if (!classCode) {
      throw new ConflictError(
        `Failed to generate unique class code after ${MAX_CODE_RETRIES} attempts`
      );
    }

    // 3. Atomic: create classroom + add creator as member.
    return baseDb.$transaction(async (tx) => {
      const classRoom = await tx.classRoom.create({
        data: {
          className: parsed.data.name.trim(),
          classCode,
          sksWeight: parsed.data.sksWeight,
          creatorId: ownerId,
        },
      });

      await tx.classRoomMember.create({
        data: {
          classRoomId: classRoom.id,
          userId: ownerId,
        },
      });

      return classRoom;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Join a classroom using a class code.
   *
   * Creates a ClassRoomMember record with role MEMBER. Also creates
   * UserTaskProgress bridge rows for all existing classroom tasks, so the
   * new member immediately sees shared tasks in their queue.
   *
   * Requirements 8.4, 8.5, 8.7.
   *
   * @param classCode The 8-character class code.
   * @param userId    The user joining the classroom.
   * @returns The membership record plus the classroom and count of tasks added.
   * @throws {NotFoundError}  If the class code is invalid.
   * @throws {ConflictError}  If the user is already a member.
   */
  static async joinClassRoom(
    classCode: string,
    userId: string
  ): Promise<JoinClassRoomResult> {
    // 1. Validate class code format.
    const codeResult = classCodeSchema.safeParse(classCode.toUpperCase().trim());
    if (!codeResult.success) {
      throw new ValidationError(
        codeResult.error.issues[0]?.message ?? "Invalid class code format"
      );
    }
    const normalizedCode = codeResult.data;

    // 2. Find the classroom.
    const classRoom = await baseDb.classRoom.findUnique({
      where: { classCode: normalizedCode },
    });
    if (!classRoom) {
      throw new NotFoundError("ClassRoom", normalizedCode);
    }

    // 3. Check for existing membership.
    const existingMembership = await baseDb.classRoomMember.findUnique({
      where: {
        classRoomId_userId: {
          classRoomId: classRoom.id,
          userId,
        },
      },
    });
    if (existingMembership) {
      throw new ConflictError("User is already a member of this classroom");
    }

    // 4. Atomic: create membership + propagate existing tasks.
    return baseDb.$transaction(async (tx) => {
      const membership = await tx.classRoomMember.create({
        data: {
          classRoomId: classRoom.id,
          userId,
        },
      });

      // Find all existing tasks in this classroom.
      const existingTasks = await tx.task.findMany({
        where: { classRoomId: classRoom.id },
        select: { id: true },
      });

      // Create bridge rows for each task (Requirement 8.7).
      let tasksAdded = 0;
      if (existingTasks.length > 0) {
        const result = await tx.userTaskProgress.createMany({
          data: existingTasks.map((task) => ({
            userId,
            taskId: task.id,
            status: "PENDING" as const,
          })),
          skipDuplicates: true,
        });
        tasksAdded = result.count;
      }

      return { membership, classRoom, tasksAdded };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Leave a classroom.
   *
   * Deletes ONLY the UserTaskProgress records associated with Tasks belonging
   * to that classroom — preserving global Task integrity while removing the
   * user's personal progress data. Also deletes the ClassRoomMember record.
   *
   * The creator cannot leave their own classroom (they must delete it instead,
   * which is a separate operation not part of this task).
   *
   * Requirement 8.10.
   *
   * @param classRoomId The classroom to leave.
   * @param userId      The user leaving the classroom.
   * @throws {NotFoundError}      If the classroom or membership does not exist.
   * @throws {ValidationError}    If the user is the classroom creator.
   */
  static async leaveClassRoom(
    classRoomId: string,
    userId: string
  ): Promise<void> {
    // 1. Verify classroom exists.
    const classRoom = await baseDb.classRoom.findUnique({
      where: { id: classRoomId },
      select: { id: true, creatorId: true },
    });
    if (!classRoom) {
      throw new NotFoundError("ClassRoom", classRoomId);
    }

    // 2. Creator cannot leave their own classroom.
    if (classRoom.creatorId === userId) {
      throw new ValidationError(
        "Classroom creator cannot leave. Delete the classroom instead."
      );
    }

    // 3. Verify membership exists.
    const membership = await baseDb.classRoomMember.findUnique({
      where: {
        classRoomId_userId: { classRoomId, userId },
      },
    });
    if (!membership) {
      throw new NotFoundError("ClassRoomMember", `${classRoomId}/${userId}`);
    }

    // 4. Atomic: delete bridge rows for classroom tasks + delete membership.
    await baseDb.$transaction(async (tx) => {
      // Find all tasks belonging to this classroom.
      const classroomTasks = await tx.task.findMany({
        where: { classRoomId },
        select: { id: true },
      });

      // Delete UserTaskProgress rows for these tasks (only for this user).
      if (classroomTasks.length > 0) {
        await tx.userTaskProgress.deleteMany({
          where: {
            userId,
            taskId: { in: classroomTasks.map((t) => t.id) },
          },
        });
      }

      // Delete the membership record.
      await tx.classRoomMember.delete({
        where: {
          classRoomId_userId: { classRoomId, userId },
        },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * Get all classrooms a user is a member of.
   *
   * Returns the ClassRoom data alongside the user's membership details
   * (join date).
   *
   * Requirement 8.6.
   *
   * @param userId The user whose classroom memberships to fetch.
   * @returns Array of classroom + membership pairs.
   */
  static async getUserClassRooms(
    userId: string
  ): Promise<ClassRoomWithMembership[]> {
    const memberships = await baseDb.classRoomMember.findMany({
      where: { userId },
      include: {
        classRoom: true,
      },
    });

    return memberships.map((m) => ({
      classRoom: m.classRoom,
      membership: {
        userId: m.userId,
        classRoomId: m.classRoomId,
        joinedAt: m.joinedAt,
      },
    }));
  }
}

/** Default singleton for ergonomic imports. */
export const classRoomService = ClassRoomService;
