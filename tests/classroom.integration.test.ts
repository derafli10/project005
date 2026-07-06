import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for ClassRoom features (Task 12.7).
 *
 * Reference: requirements.md 8.1, 8.2, 8.7, 8.8, 8.10
 */

const { mockDb, mockAuthFn } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      user: {
        findUnique: fn(),
        create: fn(),
        update: fn(),
      },
      task: {
        findUnique: fn(),
        findUniqueOrThrow: fn(),
        findMany: fn(),
        create: fn(),
        update: fn(),
      },
      userTaskProgress: {
        findUnique: fn(),
        findMany: fn(),
        create: fn(),
        createMany: fn(),
        update: fn(),
        deleteMany: fn(),
      },
      cookedScore: {
        findMany: fn(),
        upsert: fn(),
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
    mockAuthFn: fn(),
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

  // Explicitly map all operations so Prisma bindings work seamlessly
  mockDb.user.findUnique.mockImplementation(client.user.findUnique.bind(client.user));
  mockDb.user.create.mockImplementation(client.user.create.bind(client.user));
  mockDb.user.update.mockImplementation(client.user.update.bind(client.user));

  mockDb.task.findUnique.mockImplementation(client.task.findUnique.bind(client.task));
  mockDb.task.findUniqueOrThrow.mockImplementation(client.task.findUniqueOrThrow.bind(client.task));
  mockDb.task.findMany.mockImplementation(client.task.findMany.bind(client.task));
  mockDb.task.create.mockImplementation(client.task.create.bind(client.task));
  mockDb.task.update.mockImplementation(client.task.update.bind(client.task));

  mockDb.userTaskProgress.findUnique.mockImplementation(client.userTaskProgress.findUnique.bind(client.userTaskProgress));
  mockDb.userTaskProgress.findMany.mockImplementation(client.userTaskProgress.findMany.bind(client.userTaskProgress));
  mockDb.userTaskProgress.create.mockImplementation(client.userTaskProgress.create.bind(client.userTaskProgress));
  mockDb.userTaskProgress.createMany.mockImplementation(client.userTaskProgress.createMany.bind(client.userTaskProgress));
  mockDb.userTaskProgress.update.mockImplementation(client.userTaskProgress.update.bind(client.userTaskProgress));
  mockDb.userTaskProgress.deleteMany.mockImplementation(client.userTaskProgress.deleteMany.bind(client.userTaskProgress));

  mockDb.cookedScore.findMany.mockImplementation(client.cookedScore.findMany.bind(client.cookedScore));
  mockDb.cookedScore.upsert.mockImplementation(client.cookedScore.upsert.bind(client.cookedScore));

  mockDb.classRoom.findUnique.mockImplementation(client.classRoom.findUnique.bind(client.classRoom));
  mockDb.classRoom.create.mockImplementation(client.classRoom.create.bind(client.classRoom));

  mockDb.classRoomMember.findUnique.mockImplementation(client.classRoomMember.findUnique.bind(client.classRoomMember));
  mockDb.classRoomMember.findMany.mockImplementation(client.classRoomMember.findMany.bind(client.classRoomMember));
  mockDb.classRoomMember.create.mockImplementation(client.classRoomMember.create.bind(client.classRoomMember));
  mockDb.classRoomMember.delete.mockImplementation(client.classRoomMember.delete.bind(client.classRoomMember));

  mockDb.$transaction.mockImplementation(client.$transaction.bind(client));

  mockAuthFn.mockReset();
  mockAuthFn.mockResolvedValue(null);
}

vi.mock("@/lib/db", () => ({
  db: mockDb,
  baseDb: mockDb,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

vi.mock("@/auth", () => ({
  auth: mockAuthFn,
}));

vi.mock("@/i18n/server", () => ({
  getLocale: async () => "EN" as const,
}));

import { createClassRoomAction, joinClassRoomAction, leaveClassRoomAction } from "@/app/actions/classroom";
import { createTaskAction } from "@/app/actions/task";
import { ClassRoomService } from "@/lib/services/classroom.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

function seedUser(id: string): void {
  const store = getInMemoryStore();
  const now = new Date();
  store.users.set(id, {
    id,
    email: `${id}@test.example`,
    name: id,
    passwordHash: null,
    role: "MEMBER" as const,
    locale: "EN" as const,
    digestEnabled: false,
    digestTime: null,
    deliveryChannel: "WHATSAPP" as const,
    whatsappNumber: null,
    telegramChatId: null,
    createdAt: now,
    updatedAt: now,
  });
  store.usersByEmail.set(`${id}@test.example`, id);
}

describe("ClassRoom Features Integration Tests", () => {
  it("runs the complete flow: create classroom -> join classroom -> create shared task", async () => {
    const creatorId = "creator_user";
    const memberId = "member_user";

    seedUser(creatorId);
    seedUser(memberId);

    // 1. Authenticate as creator and create classroom (Requirement 8.1, 8.3)
    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });
    const createRes = await createClassRoomAction("Computer Science 101", 4);
    expect(createRes.success).toBe(true);
    if (!createRes.success) throw new Error(createRes.error);
    const classCode = createRes.data.classCode;
    const classRoomId = createRes.data.id;
    expect(classCode).toHaveLength(8);
    expect(classRoomId).toBeDefined();

    // Verify creator is automatically a member (Requirement 8.7)
    const store = getInMemoryStore();
    expect(store.classRoomMembers.has(`${classRoomId}/${creatorId}`)).toBe(true);

    // 2. Authenticate as member and join classroom (Requirement 8.4, 8.5)
    mockAuthFn.mockResolvedValue({ user: { id: memberId } });
    const joinRes = await joinClassRoomAction(classCode);
    expect(joinRes.success).toBe(true);
    expect(store.classRoomMembers.has(`${classRoomId}/${memberId}`)).toBe(true);

    // 3. Authenticate as creator and create a shared task in classroom (Requirement 8.6, 8.7)
    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });
    const deadlineAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString();
    const taskRes = await createTaskAction({
      title: "Class Project Phase 1",
      taskWeight: 4000,
      sksWeight: 4,
      deadlineAt,
      classRoomId,
    });
    if (!taskRes.success) {
      console.error("taskRes failed with error:", taskRes.error, taskRes.fieldErrors);
    }
    expect(taskRes.success).toBe(true);
    if (!taskRes.success) throw new Error(taskRes.error);
    const taskId = taskRes.data.id;

    // Verify UserTaskProgress is propagated to both classroom members (Requirement 8.7)
    expect(store.userTaskProgress.has(`${creatorId}/${taskId}`)).toBe(true);
    expect(store.userTaskProgress.has(`${memberId}/${taskId}`)).toBe(true);
  });

  it("validates classroom code uniqueness on creation", async () => {
    const creatorId = "creator_user";
    seedUser(creatorId);

    // Setup mock class code generator to return the same code first
    const generatedCodes = ["COLLIDE8", "COLLIDE8", "UNIQUE99"];
    let genIndex = 0;
    const spy = vi.spyOn(ClassRoomService, "generateClassCode").mockImplementation(() => {
      return generatedCodes[genIndex++]!;
    });

    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });

    try {
      // Create first classroom with COLLIDE8
      const res1 = await createClassRoomAction("First Class", 3);
      expect(res1.success).toBe(true);
      if (!res1.success) throw new Error(res1.error);
      expect(res1.data.classCode).toBe("COLLIDE8");

      // Second classroom should trigger a collision on COLLIDE8, retry, and successfully generate UNIQUE99 (Requirement 8.2)
      const res2 = await createClassRoomAction("Second Class", 4);
      expect(res2.success).toBe(true);
      if (!res2.success) throw new Error(res2.error);
      expect(res2.data.classCode).toBe("UNIQUE99");

      // Verify both exist
      const store = getInMemoryStore();
      expect(store.classRooms.has(res1.data.id)).toBe(true);
      expect(store.classRooms.has(res2.data.id)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("propagates tasks to joining members when they join a classroom with existing tasks", async () => {
    const creatorId = "creator_user";
    const memberId = "member_user";

    seedUser(creatorId);
    seedUser(memberId);

    // Create classroom as creator
    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });
    const createRes = await createClassRoomAction("Data Science 101", 3);
    if (!createRes.success) throw new Error(createRes.error);
    const classRoomId = createRes.data.id;
    const classCode = createRes.data.classCode;

    // Create a shared task when only creator is in the class
    const deadlineAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString();
    const taskRes = await createTaskAction({
      title: "Initial Assignment",
      taskWeight: 2000,
      sksWeight: 3,
      deadlineAt,
      classRoomId,
    });
    if (!taskRes.success) throw new Error(taskRes.error);
    const taskId = taskRes.data.id;

    const store = getInMemoryStore();
    expect(store.userTaskProgress.has(`${creatorId}/${taskId}`)).toBe(true);
    expect(store.userTaskProgress.has(`${memberId}/${taskId}`)).toBe(false);

    // Member joins classroom
    mockAuthFn.mockResolvedValue({ user: { id: memberId } });
    const joinRes = await joinClassRoomAction(classCode);
    expect(joinRes.success).toBe(true);

    // Verify existing task was propagated to the new member upon joining (Requirement 8.7)
    expect(store.userTaskProgress.has(`${memberId}/${taskId}`)).toBe(true);
  });

  it("deletes only UserTaskProgress and memberships when leaving classroom, preserving the global Task record", async () => {
    const creatorId = "creator_user";
    const memberId = "member_user";

    seedUser(creatorId);
    seedUser(memberId);

    // Setup classroom and task
    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });
    const createRes = await createClassRoomAction("Calculus 101", 4);
    if (!createRes.success) throw new Error(createRes.error);
    const classRoomId = createRes.data.id;
    const classCode = createRes.data.classCode;

    mockAuthFn.mockResolvedValue({ user: { id: memberId } });
    await joinClassRoomAction(classCode);

    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });
    const deadlineAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString();
    const taskRes = await createTaskAction({
      title: "Shared Homework",
      taskWeight: 3000,
      deadlineAt,
      classRoomId,
    });
    if (!taskRes.success) throw new Error(taskRes.error);
    const taskId = taskRes.data.id;

    const store = getInMemoryStore();
    expect(store.classRoomMembers.has(`${classRoomId}/${memberId}`)).toBe(true);
    expect(store.userTaskProgress.has(`${memberId}/${taskId}`)).toBe(true);

    // Member leaves classroom (Requirement 8.10)
    mockAuthFn.mockResolvedValue({ user: { id: memberId } });
    const leaveRes = await leaveClassRoomAction(classRoomId);
    expect(leaveRes.success).toBe(true);

    // Assert membership and progress are deleted for this user
    expect(store.classRoomMembers.has(`${classRoomId}/${memberId}`)).toBe(false);
    expect(store.userTaskProgress.has(`${memberId}/${taskId}`)).toBe(false);

    // Assert global Task and creator's progress are preserved
    expect(store.tasks.has(taskId)).toBe(true);
    expect(store.userTaskProgress.has(`${creatorId}/${taskId}`)).toBe(true);
  });
});