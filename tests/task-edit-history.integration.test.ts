import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for Task Edit History (Task 13.4).
 *
 * @tags Feature: project005-task-management-dss, Task 13.4
 *
 * Reference: tasks.md 13.4, design.md > Task Edit History Service,
 *   Requirements 9.1, 9.2, 9.6, 9.7, 9.9
 *
 * Scope
 *   These tests exercise the **integration boundary** between the Task Edit
 *   History UI components and the Server Actions / Services they call. The
 *   tests verify the audit trail behavior the UI depends on:
 *
 *     1. TaskEditLog creation when task fields change (Req 9.1, 9.2)
 *     2. Audit trail display with oldValue/newValue comparison (Req 9.6)
 *     3. Unread badge count calculation (Req 9.7)
 *     4. Mark as read functionality when viewing history (Req 9.9)
 *
 * Requirements: 9.1, 9.2, 9.6, 9.7, 9.9
 */

// ─── Mock harness ───────────────────────────────────────────────────────────

const { mockDb, mockAuthFn } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
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
      },
      taskEditLog: {
        findMany: fn(),
        createMany: fn(),
        create: fn(),
      },
      taskEditLogRead: {
        findMany: fn(),
        createMany: fn(),
        upsert: fn(),
      },
      classRoom: {
        findUnique: fn(),
      },
      classRoomMember: {
        findUnique: fn(),
        findMany: fn(),
      },
      $transaction: fn(),
    },
    mockAuthFn: fn(),
  };
});

let client: ReturnType<typeof buildInMemoryClient>;

/**
 * Recursively bind each `vi.fn()` stub in `mockDb` to the matching method on
 * the freshly-built in-memory client.
 */
function bind(stub: Record<string, unknown>, real: Record<string, unknown>) {
  for (const key of Object.keys(real)) {
    const realMember = real[key];
    const stubMember = stub[key];
    if (typeof realMember === "function") {
      if (stubMember) {
        (stubMember as Mock).mockImplementation(
          (realMember as (...a: unknown[]) => unknown).bind(real),
        );
      }
    } else if (realMember && typeof realMember === "object" && stubMember) {
      bind(
        stubMember as Record<string, unknown>,
        realMember as Record<string, unknown>,
      );
    }
  }
}

function hydrateMock() {
  client = buildInMemoryClient();
  vi.clearAllMocks();
  bind(
    mockDb as unknown as Record<string, unknown>,
    client as unknown as Record<string, unknown>,
  );
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

// Service / action imports MUST come after every vi.mock declaration above.
import { TaskService } from "@/lib/services/task.service";
import {
  getTaskEditHistoryAction,
  getUnreadNotificationsAction,
} from "@/app/actions/task";
import type {
  InMemoryUser,
  InMemoryTask,
  InMemoryClassRoom,
} from "./helpers/store";

// Use in-memory types instead of Prisma types
type User = InMemoryUser;
type Task = InMemoryTask;
type ClassRoom = InMemoryClassRoom;

// ─── Arbitraries ────────────────────────────────────────────────────────────

const userIdArb = fc.uuid();
const taskIdArb = fc.uuid();
const classCodeArb = fc.string({ minLength: 8, maxLength: 8 });
const titleArb = fc.string({ minLength: 5, maxLength: 60 }).filter(s => s.trim().length >= 3);
const taskWeightArb = fc.integer({ min: 0, max: 10000 });
const sksWeightArb = fc.integer({ min: 1, max: 5 });
const futureHoursArb = fc.integer({ min: 1, max: 720 }); // 1 hour to 30 days

function seedUser(overrides?: Partial<User>): User {
  const store = getInMemoryStore();
  const id = overrides?.id ?? fc.sample(userIdArb, 1)[0]!;
  const user: User = {
    id,
    email: `user-${id.slice(0, 8)}@example.com`,
    name: `User ${id.slice(0, 8)}`,
    passwordHash: "hashed",
    role: "MEMBER",
    locale: "EN",
    digestEnabled: false,
    digestTime: null,
    deliveryChannel: "WHATSAPP",
    whatsappNumber: null,
    telegramChatId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  store.users.set(id, user);
  return user;
}

function seedClassRoom(creatorId: string, overrides?: Partial<ClassRoom>): ClassRoom {
  const store = getInMemoryStore();
  const id = overrides?.id ?? fc.sample(fc.uuid(), 1)[0]!;
  const classCode = overrides?.classCode ?? fc.sample(classCodeArb, 1)[0]!;
  const classRoom: ClassRoom = {
    id,
    className: `Class ${classCode}`,
    classCode,
    sksWeight: 3,
    creatorId,
    createdAt: new Date(),
    ...overrides,
  };
  store.classRooms.set(id, classRoom);
  store.classRoomsByCode.set(classCode, id);
  return classRoom;
}

function seedTask(
  creatorId: string,
  classRoomId: string | null,
  overrides?: Partial<Task>,
): Task {
  const store = getInMemoryStore();
  const id = overrides?.id ?? fc.sample(taskIdArb, 1)[0]!;
  const now = new Date();
  const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const task: Task = {
    id,
    title: fc.sample(titleArb, 1)[0]!,
    description: null,
    sksWeight: 3,
    taskWeight: 5000,
    deadlineAt: deadline,
    isSubTask: false,
    parentTaskId: null,
    classRoomId,
    creatorId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  store.tasks.set(id, task);
  return task;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Task Edit History Integration", () => {
  beforeEach(() => {
    resetInMemoryDb();
    hydrateMock();
  });

  describe("TaskEditLog Creation (Req 9.1, 9.2)", () => {
    it("creates TaskEditLog records when task fields are updated", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(titleArb, taskWeightArb, futureHoursArb),
          fc.tuple(titleArb, taskWeightArb, futureHoursArb),
          async ([initialTitle, initialWeight, initialHours], [newTitle, newWeight, newHours]) => {
            // Skip if all values are effectively the same after trimming
            fc.pre(
              initialTitle.trim() !== newTitle.trim() ||
              initialWeight !== newWeight ||
              initialHours !== newHours
            );

            resetInMemoryDb();
            hydrateMock();

            const creator = seedUser();
            const classRoom = seedClassRoom(creator.id);
            const now = new Date();
            const initialDeadline = new Date(now.getTime() + initialHours * 60 * 60 * 1000);
            const newDeadline = new Date(now.getTime() + newHours * 60 * 60 * 1000);

            const task = seedTask(creator.id, classRoom.id, {
              title: initialTitle,
              taskWeight: initialWeight,
              deadlineAt: initialDeadline,
            });

            // Seed UserTaskProgress for creator
            const store = getInMemoryStore();
            store.userTaskProgress.set(`${creator.id}/${task.id}`, {
              userId: creator.id,
              taskId: task.id,
              status: "PENDING",
              position: null,
              completedAt: null,
              currentStressScore: 0,
            });

            // Update task with new values
            await TaskService.updateTask(task.id, creator.id, {
              title: newTitle,
              taskWeight: newWeight,
              deadlineAt: newDeadline,
            });

            // Verify TaskEditLog records were created for changed fields
            const editLogs = Array.from(store.taskEditLogs.values()).filter(
              (log) => log.taskId === task.id
            );

            // Should have logs for changed fields only
            const changedFields: string[] = [];
            if (initialTitle.trim() !== newTitle.trim()) changedFields.push("title");
            if (initialWeight !== newWeight) changedFields.push("taskWeight");
            if (initialDeadline.getTime() !== newDeadline.getTime())
              changedFields.push("deadlineAt");

            expect(editLogs.length).toBe(changedFields.length);

            // Verify each log has correct structure (Req 9.1)
            for (const log of editLogs) {
              expect(log).toMatchObject({
                taskId: task.id,
                editorId: creator.id,
              });
              expect(log.fieldName).toBeDefined();
              expect(log.oldValue).toBeDefined();
              expect(log.newValue).toBeDefined();
              expect(log.editedAt).toBeInstanceOf(Date);
              expect(changedFields).toContain(log.fieldName);
            }

            // Verify old/new values are captured correctly
            const titleLog = editLogs.find((log) => log.fieldName === "title");
            if (titleLog) {
              // Title values are trimmed by the service
              expect(titleLog.oldValue).toBe(initialTitle.trim());
              expect(titleLog.newValue).toBe(newTitle.trim());
            }

            const weightLog = editLogs.find((log) => log.fieldName === "taskWeight");
            if (weightLog) {
              expect(weightLog.oldValue).toBe(String(initialWeight));
              expect(weightLog.newValue).toBe(String(newWeight));
            }

            const deadlineLog = editLogs.find((log) => log.fieldName === "deadlineAt");
            if (deadlineLog) {
              expect(deadlineLog.oldValue).toBe(initialDeadline.toISOString());
              expect(deadlineLog.newValue).toBe(newDeadline.toISOString());
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it("does not create TaskEditLog for unchanged fields", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task = seedTask(creator.id, classRoom.id, {
        title: "Original Title",
        taskWeight: 5000,
      });

      const store = getInMemoryStore();
      store.userTaskProgress.set(`${creator.id}/${task.id}`, {
        userId: creator.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      // Update with same title but different weight
      await TaskService.updateTask(task.id, creator.id, {
        title: "Original Title", // unchanged
        taskWeight: 7000, // changed
      });

      const editLogs = Array.from(store.taskEditLogs.values()).filter(
        (log) => log.taskId === task.id
      );

      // Should only have log for taskWeight, not title
      expect(editLogs.length).toBe(1);
      expect(editLogs[0]?.fieldName).toBe("taskWeight");
    });
  });

  describe("Audit Trail Display (Req 9.6)", () => {
    it("getTaskEditHistory returns entries with oldValue/newValue comparison", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const member = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task = seedTask(creator.id, classRoom.id);

      const store = getInMemoryStore();

      // Seed UserTaskProgress for both users
      store.userTaskProgress.set(`${creator.id}/${task.id}`, {
        userId: creator.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });
      store.userTaskProgress.set(`${member.id}/${task.id}`, {
        userId: member.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      // Create edit log manually
      const logId = fc.sample(fc.uuid(), 1)[0]!;
      const editedAt = new Date();
      store.taskEditLogs.set(logId, {
        id: logId,
        taskId: task.id,
        editorId: creator.id,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt,
      });

      // Fetch history as member
      const history = await TaskService.getTaskEditHistory(task.id, member.id);

      // Verify history structure (Req 9.6)
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        id: logId,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt,
        editorId: creator.id,
        editorName: creator.name,
      });
    });

    it("getTaskEditHistory throws AuthorizationError for users without access", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const outsider = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task = seedTask(creator.id, classRoom.id);

      const store = getInMemoryStore();
      store.userTaskProgress.set(`${creator.id}/${task.id}`, {
        userId: creator.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      // Outsider has no UserTaskProgress bridge row
      await expect(
        TaskService.getTaskEditHistory(task.id, outsider.id)
      ).rejects.toThrow("You don't have access to this task's history");
    });
  });

  describe("Unread Badge Count (Req 9.7)", () => {
    it("getUnreadNotifications returns unread TaskEditLog entries", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const member = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task1 = seedTask(creator.id, classRoom.id, { title: "Task 1" });
      const task2 = seedTask(creator.id, classRoom.id, { title: "Task 2" });

      const store = getInMemoryStore();

      // Seed UserTaskProgress for member
      store.userTaskProgress.set(`${member.id}/${task1.id}`, {
        userId: member.id,
        taskId: task1.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });
      store.userTaskProgress.set(`${member.id}/${task2.id}`, {
        userId: member.id,
        taskId: task2.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      // Create edit logs for both tasks
      const log1Id = fc.sample(fc.uuid(), 1)[0]!;
      const log2Id = fc.sample(fc.uuid(), 1)[0]!;
      const editedAt = new Date();

      store.taskEditLogs.set(log1Id, {
        id: log1Id,
        taskId: task1.id,
        editorId: creator.id,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt,
      });

      store.taskEditLogs.set(log2Id, {
        id: log2Id,
        taskId: task2.id,
        editorId: creator.id,
        fieldName: "title",
        oldValue: "Old Title",
        newValue: "New Title",
        editedAt,
      });

      // Fetch unread notifications
      const unread = await TaskService.getUnreadNotifications(member.id);

      // Should return both unread logs (Req 9.7)
      expect(unread).toHaveLength(2);
      expect(unread[0]).toMatchObject({
        taskId: task1.id,
        taskTitle: task1.title,
        editorName: creator.name,
      });
      expect(unread[1]).toMatchObject({
        taskId: task2.id,
        taskTitle: task2.title,
        editorName: creator.name,
      });
    });

    it("excludes read logs from unread count", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const member = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task = seedTask(creator.id, classRoom.id);

      const store = getInMemoryStore();

      store.userTaskProgress.set(`${member.id}/${task.id}`, {
        userId: member.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      const logId = fc.sample(fc.uuid(), 1)[0]!;
      store.taskEditLogs.set(logId, {
        id: logId,
        taskId: task.id,
        editorId: creator.id,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt: new Date(),
      });

      // Mark as read
      store.taskEditLogReads.set(`${logId}/${member.id}`, {
        logId,
        userId: member.id,
        isRead: true,
      });

      const unread = await TaskService.getUnreadNotifications(member.id);

      // Should return empty array since log is read
      expect(unread).toHaveLength(0);
    });
  });

  describe("Mark as Read Functionality (Req 9.9)", () => {
    it("marks TaskEditLog entries as read when viewing history", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const member = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task = seedTask(creator.id, classRoom.id);

      const store = getInMemoryStore();

      store.userTaskProgress.set(`${member.id}/${task.id}`, {
        userId: member.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      // Create multiple edit logs
      const log1Id = fc.sample(fc.uuid(), 1)[0]!;
      const log2Id = fc.sample(fc.uuid(), 1)[0]!;

      store.taskEditLogs.set(log1Id, {
        id: log1Id,
        taskId: task.id,
        editorId: creator.id,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt: new Date(),
      });

      store.taskEditLogs.set(log2Id, {
        id: log2Id,
        taskId: task.id,
        editorId: creator.id,
        fieldName: "title",
        oldValue: "Old",
        newValue: "New",
        editedAt: new Date(),
      });

      // Verify no read records exist initially
      expect(store.taskEditLogReads.size).toBe(0);

      // View history as member (should mark as read - Req 9.9)
      await TaskService.getTaskEditHistory(task.id, member.id);

      // Verify read records were created
      const readRecords = Array.from(store.taskEditLogReads.values()).filter(
        (r) => r.userId === member.id
      );

      expect(readRecords).toHaveLength(2);
      expect(readRecords.every((r) => r.isRead === true)).toBe(true);
      expect(readRecords.map((r) => r.logId).sort()).toEqual([log1Id, log2Id].sort());
    });

    it("does not create duplicate read records on subsequent views", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const member = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task = seedTask(creator.id, classRoom.id);

      const store = getInMemoryStore();

      store.userTaskProgress.set(`${member.id}/${task.id}`, {
        userId: member.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      const logId = fc.sample(fc.uuid(), 1)[0]!;
      store.taskEditLogs.set(logId, {
        id: logId,
        taskId: task.id,
        editorId: creator.id,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt: new Date(),
      });

      // View history twice
      await TaskService.getTaskEditHistory(task.id, member.id);
      await TaskService.getTaskEditHistory(task.id, member.id);

      // Should still only have one read record (skipDuplicates)
      const readRecords = Array.from(store.taskEditLogReads.values()).filter(
        (r) => r.userId === member.id
      );

      expect(readRecords).toHaveLength(1);
    });

    it("does not mark creator's own edits as read", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const task = seedTask(creator.id, null);

      const store = getInMemoryStore();

      store.userTaskProgress.set(`${creator.id}/${task.id}`, {
        userId: creator.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      const logId = fc.sample(fc.uuid(), 1)[0]!;
      store.taskEditLogs.set(logId, {
        id: logId,
        taskId: task.id,
        editorId: creator.id,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt: new Date(),
      });

      // Creator views their own task history
      await TaskService.getTaskEditHistory(task.id, creator.id);

      // Should not create read records for creator's own edits
      const readRecords = Array.from(store.taskEditLogReads.values()).filter(
        (r) => r.userId === creator.id
      );

      expect(readRecords).toHaveLength(0);
    });
  });

  describe("Server Action Integration", () => {
    it("getTaskEditHistoryAction returns success with history data", async () => {
      resetInMemoryDb();
      hydrateMock();

      const user = seedUser();
      const task = seedTask(user.id, null);

      const store = getInMemoryStore();
      store.userTaskProgress.set(`${user.id}/${task.id}`, {
        userId: user.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      const logId = fc.sample(fc.uuid(), 1)[0]!;
      store.taskEditLogs.set(logId, {
        id: logId,
        taskId: task.id,
        editorId: user.id,
        fieldName: "title",
        oldValue: "Old",
        newValue: "New",
        editedAt: new Date(),
      });

      // Mock auth
      mockAuthFn.mockResolvedValue({ user: { id: user.id } });

      const result = await getTaskEditHistoryAction(task.id);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toMatchObject({
          fieldName: "title",
          oldValue: "Old",
          newValue: "New",
        });
      }
    });

    it("getTaskEditHistoryAction returns error when unauthorized", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const task = seedTask(creator.id, null);

      // Mock unauthenticated request
      mockAuthFn.mockResolvedValue(null);

      const result = await getTaskEditHistoryAction(task.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("You must be logged in");
      }
    });

    it("getUnreadNotificationsAction returns unread count", async () => {
      resetInMemoryDb();
      hydrateMock();

      const creator = seedUser();
      const member = seedUser();
      const classRoom = seedClassRoom(creator.id);
      const task = seedTask(creator.id, classRoom.id);

      const store = getInMemoryStore();
      store.userTaskProgress.set(`${member.id}/${task.id}`, {
        userId: member.id,
        taskId: task.id,
        status: "PENDING",
        position: null,
        completedAt: null,
        currentStressScore: 0,
      });

      const logId = fc.sample(fc.uuid(), 1)[0]!;
      store.taskEditLogs.set(logId, {
        id: logId,
        taskId: task.id,
        editorId: creator.id,
        fieldName: "taskWeight",
        oldValue: "5000",
        newValue: "7000",
        editedAt: new Date(),
      });

      // Mock auth as member
      mockAuthFn.mockResolvedValue({ user: { id: member.id } });

      const result = await getUnreadNotificationsAction();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.taskId).toBe(task.id);
      }
    });
  });
});
