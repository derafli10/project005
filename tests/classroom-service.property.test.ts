import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Property-based and unit tests for the ClassRoom Service.
 *
 * @tags Feature: project005-task-management-dss, Property 15, Property 16, Property 17
 *
 * Reference: design.md > Correctness Properties 15–17, Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.10.
 */

// ─── Mock: vi.hoisted ensures the stubs exist before the hoisted vi.mock ────

const { mockDb } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      user: {
        findUnique: fn(),
        create: fn(),
      },
      task: {
        findUnique: fn(),
        findUniqueOrThrow: fn(),
        create: fn(),
        update: fn(),
        findMany: fn(),
      },
      userTaskProgress: {
        findUnique: fn(),
        findMany: fn(),
        create: fn(),
        createMany: fn(),
        update: fn(),
        deleteMany: fn(),
      },
      classRoom: {
        findUnique: fn(),
        create: fn(),
      },
      classRoomMember: {
        findUnique: fn(),
        findMany: fn(),
        create: fn(),
        delete: fn(),
      },
      $transaction: fn(),
    },
  };
});

let client: ReturnType<typeof buildInMemoryClient>;

function bind(stub: Record<string, unknown>, real: Record<string, unknown>) {
  for (const key of Object.keys(real)) {
    const realMember = real[key];
    const stubMember = stub[key];
    if (typeof realMember === "function") {
      if (stubMember) {
        (stubMember as Mock).mockImplementation(
          (realMember as (...a: unknown[]) => unknown).bind(real)
        );
      }
    } else if (realMember && typeof realMember === "object" && stubMember) {
      bind(
        stubMember as Record<string, unknown>,
        realMember as Record<string, unknown>
      );
    }
  }
}

function hydrateMock() {
  client = buildInMemoryClient();
  vi.clearAllMocks();
  bind(
    mockDb as unknown as Record<string, unknown>,
    client as unknown as Record<string, unknown>
  );
}

vi.mock("@/lib/db", () => ({
  db: mockDb,
  baseDb: mockDb,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

// Service imports MUST come after vi.mock declarations.
import { ClassRoomService } from "@/lib/services/classroom.service";
import { TaskService } from "@/lib/services/task.service";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors/domain-errors";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

// ─── Property 15: Class Code Uniqueness Validation ──────────────────────────

describe("Property 15: Class Code Uniqueness Validation", () => {
  it("generates an 8-character code from a safe alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const code = ClassRoomService.generateClassCode();
      expect(code).toHaveLength(8);
      // ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (excl. 0, O, 1, I, l)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it("retries on class code collision and succeeds if it finds a unique code within 5 attempts", async () => {
    let callCount = 0;
    mockDb.classRoom.findUnique.mockImplementation(async () => {
      callCount++;
      if (callCount < 4) {
        return { id: "existing-class-id" };
      }
      return null;
    });

    const classRoom = await ClassRoomService.createClassRoom("Physics 101", "user-1", 4);
    expect(classRoom).toBeDefined();
    expect(callCount).toBe(4);
  });

  it("throws ConflictError if all 5 class code attempts collide", async () => {
    mockDb.classRoom.findUnique.mockResolvedValue({ id: "always-existing" });
    await expect(
      ClassRoomService.createClassRoom("Physics 101", "user-1", 4)
    ).rejects.toThrow(ConflictError);
  });
});

// ─── Property 16: Valid Class Code Join Creates Membership ──────────────────

describe("Property 16: Valid Class Code Join Creates Membership", () => {
  it("creates ClassRoomMember and propagates tasks for valid class code, throws for invalid/duplicate", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2, maxLength: 100 }), // className
        fc.string({ minLength: 5, maxLength: 20 }),  // creatorId
        fc.integer({ min: 1, max: 5 }),             // sksWeight
        fc.string({ minLength: 5, maxLength: 20 }),  // memberId
        async (className, creatorId, sksWeight, memberId) => {
          fc.pre(creatorId !== memberId);
          resetInMemoryDb();
          hydrateMock();

          // Create classroom
          const classRoom = await ClassRoomService.createClassRoom(className, creatorId, sksWeight);
          
          // 1. Join with valid code
          const result = await ClassRoomService.joinClassRoom(classRoom.classCode, memberId);
          expect(result.membership).toBeDefined();
          expect(result.membership.userId).toBe(memberId);
          expect(result.membership.classRoomId).toBe(classRoom.id);
          expect(result.classRoom.id).toBe(classRoom.id);

          // 2. Join again should fail with ConflictError
          await expect(
            ClassRoomService.joinClassRoom(classRoom.classCode, memberId)
          ).rejects.toThrow(ConflictError);

          // 3. Join non-existent should fail with NotFoundError
          const nonExistentCode = classRoom.classCode === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA";
          await expect(
            ClassRoomService.joinClassRoom(nonExistentCode, memberId)
          ).rejects.toThrow(NotFoundError);

          // 4. Join with invalid format should fail with ValidationError
          await expect(
            ClassRoomService.joinClassRoom("SHORT", memberId)
          ).rejects.toThrow(ValidationError);
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ─── Property 17: Classroom Task Propagation to All Members ───────────────

describe("Property 17: Classroom Task Propagation to All Members", () => {
  it("asserts exactly N UserTaskProgress records exist for N members and T tasks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }), // classroom size N (including creator)
        fc.integer({ min: 1, max: 10 }), // number of tasks T
        async (n, t) => {
          resetInMemoryDb();
          hydrateMock();

          const creatorId = "creator_user";
          const className = "Class 101";
          const sksWeight = 3;

          // Create classroom
          const classRoom = await ClassRoomService.createClassRoom(className, creatorId, sksWeight);

          // We will generate N-1 member IDs.
          const memberIds: string[] = [];
          for (let i = 1; i < n; i++) {
            memberIds.push(`member_${i}`);
          }

          // Case A: Create tasks first, then members join
          const tasksA = Math.floor(t / 2);
          const tasksB = t - tasksA;

          // Helper to create a task in the classroom
          const createClassroomTask = async (creator: string, index: number) => {
            const deadlineAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5); // 5 days in future
            await TaskService.createTask(creator, {
              title: `Task ${index}`,
              description: `Task description ${index}`,
              taskWeight: 500,
              sksWeight: undefined,
              deadlineAt,
              classRoomId: classRoom.id,
            });
          };

          // 1. Create tasksA tasks when only the creator is in the class
          for (let i = 0; i < tasksA; i++) {
            await createClassroomTask(creatorId, i);
          }

          // 2. Members join one-by-one, propagating tasksA tasks
          for (const memberId of memberIds) {
            await ClassRoomService.joinClassRoom(classRoom.classCode, memberId);
          }

          // 3. Create tasksB tasks now that all N members are in the class
          for (let i = 0; i < tasksB; i++) {
            await createClassroomTask(creatorId, tasksA + i);
          }

          // 4. Assert total UserTaskProgress records count is exactly N * T
          const store = getInMemoryStore();
          const expectedProgressCount = n * t;
          
          expect(store.userTaskProgress.size).toBe(expectedProgressCount);

          // Verify every member has exactly T progress records
          const allMembers = [creatorId, ...memberIds];
          for (const memberId of allMembers) {
            const memberProgress = Array.from(store.userTaskProgress.values()).filter(
              (p) => p.userId === memberId
            );
            expect(memberProgress).toHaveLength(t);
          }
        }
      ),
      { numRuns: 15 }
    );
  });
});

// ─── leaveClassRoom ────────────────────────────────────────────────────────

describe("ClassRoomService.leaveClassRoom", () => {
  it("successfully deletes only classroom task progress and membership, preserving other tasks and users", async () => {
    resetInMemoryDb();
    hydrateMock();

    const creatorId = "creator_user";
    const memberId = "member_user";
    const otherMemberId = "other_member_user";
    
    // Create classroom
    const classRoom = await ClassRoomService.createClassRoom("Math 101", creatorId, 3);
    
    // Join members
    await ClassRoomService.joinClassRoom(classRoom.classCode, memberId);
    await ClassRoomService.joinClassRoom(classRoom.classCode, otherMemberId);

    // Create a classroom task
    const deadlineAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
    const classTask = await TaskService.createTask(creatorId, {
      title: "Class Homework",
      taskWeight: 1000,
      deadlineAt,
      classRoomId: classRoom.id,
    });

    // Create a personal task for the member leaving
    const personalTask = await TaskService.createTask(memberId, {
      title: "My Personal Task",
      taskWeight: 2000,
      deadlineAt,
    });

    const store = getInMemoryStore();

    // Verify initial state
    expect(store.classRoomMembers.has(`${classRoom.id}/${memberId}`)).toBe(true);
    expect(store.userTaskProgress.has(`${memberId}/${classTask.id}`)).toBe(true);
    expect(store.userTaskProgress.has(`${memberId}/${personalTask.id}`)).toBe(true);
    expect(store.userTaskProgress.has(`${otherMemberId}/${classTask.id}`)).toBe(true);

    // Member leaves classroom
    await ClassRoomService.leaveClassRoom(classRoom.id, memberId);

    // Assert membership is deleted
    expect(store.classRoomMembers.has(`${classRoom.id}/${memberId}`)).toBe(false);

    // Assert classroom task progress for this user is deleted
    expect(store.userTaskProgress.has(`${memberId}/${classTask.id}`)).toBe(false);

    // Assert personal task progress for this user is PRESERVED
    expect(store.userTaskProgress.has(`${memberId}/${personalTask.id}`)).toBe(true);

    // Assert other member's task progress is PRESERVED
    expect(store.userTaskProgress.has(`${otherMemberId}/${classTask.id}`)).toBe(true);

    // Assert shared Task record is PRESERVED
    expect(store.tasks.has(classTask.id)).toBe(true);
  });

  it("throws ValidationError if the creator tries to leave", async () => {
    resetInMemoryDb();
    hydrateMock();

    const creatorId = "creator_user";
    const classRoom = await ClassRoomService.createClassRoom("Math 101", creatorId, 3);

    await expect(
      ClassRoomService.leaveClassRoom(classRoom.id, creatorId)
    ).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError if the classroom or membership does not exist", async () => {
    resetInMemoryDb();
    hydrateMock();

    await expect(
      ClassRoomService.leaveClassRoom("nonexistent-class", "some-user")
    ).rejects.toThrow(NotFoundError);

    const creatorId = "creator_user";
    const classRoom = await ClassRoomService.createClassRoom("Math 101", creatorId, 3);

    await expect(
      ClassRoomService.leaveClassRoom(classRoom.id, "non-member")
    ).rejects.toThrow(NotFoundError);
  });
});

// ─── getUserClassRooms ─────────────────────────────────────────────────────

describe("ClassRoomService.getUserClassRooms", () => {
  it("fetches all classrooms a user belongs to alongside membership details", async () => {
    resetInMemoryDb();
    hydrateMock();

    const creator1 = "creator_1";
    const creator2 = "creator_2";
    const memberId = "member_user";

    const class1 = await ClassRoomService.createClassRoom("Class A", creator1, 3);
    const class2 = await ClassRoomService.createClassRoom("Class B", creator2, 4);
    const class3 = await ClassRoomService.createClassRoom("Class C", memberId, 5); // member is creator of this one

    await ClassRoomService.joinClassRoom(class1.classCode, memberId);
    await ClassRoomService.joinClassRoom(class2.classCode, memberId);

    const classrooms = await ClassRoomService.getUserClassRooms(memberId);
    expect(classrooms).toHaveLength(3);

    const ids = classrooms.map((c) => c.classRoom.id);
    expect(ids).toContain(class1.id);
    expect(ids).toContain(class2.id);
    expect(ids).toContain(class3.id);
    
    for (const item of classrooms) {
      expect(item.membership.userId).toBe(memberId);
      expect(item.membership.classRoomId).toBe(item.classRoom.id);
      expect(item.membership.joinedAt).toBeInstanceOf(Date);
    }
  });
});
