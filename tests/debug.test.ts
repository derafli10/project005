import { describe, it, vi } from "vitest";
import type { Mock } from "vitest";

const { mockDb } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      user: {
        findUnique: fn(),
        create: fn(),
      },
      task: {
        findMany: fn(),
        create: fn(),
      },
      userTaskProgress: {
        count: fn(),
        findMany: fn(),
        create: fn(),
      },
      taskEditLog: {
        create: fn(),
        createMany: fn(),
        findMany: fn(),
      },
      dailyDigestLog: {
        create: fn(),
        update: fn(),
      },
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

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";
import { DailyDigestService } from "@/lib/services/daily-digest.service";

describe("debug", () => {
  it("runs a simple digest test", async () => {
    resetInMemoryDb();
    hydrateMock();
    const client = buildInMemoryClient();
    
    // Create user
    const u = await client.user.create({
      data: {
        id: "user_1",
        email: "test@test.com",
        digestEnabled: true,
        digestTime: "12:00",
      }
    });

    const store = getInMemoryStore();
    
    // Add parent task
    store.tasks.set("task_1", {
      id: "task_1",
      title: "Parent Task 1",
      description: null,
      sksWeight: 3,
      taskWeight: 5000,
      deadlineAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      isSubTask: false,
      parentTaskId: null,
      classRoomId: null,
      creatorId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    store.userTaskProgress.set("user_1/task_1", {
      userId: "user_1",
      taskId: "task_1",
      status: "PENDING",
      position: null,
      completedAt: null,
      currentStressScore: 0,
    });

    // Add subtask (should be filtered out)
    store.tasks.set("task_2", {
      id: "task_2",
      title: "SubTask 2",
      description: null,
      sksWeight: 3,
      taskWeight: 2000,
      deadlineAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      isSubTask: true,
      parentTaskId: "task_1",
      classRoomId: null,
      creatorId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    store.userTaskProgress.set("user_1/task_2", {
      userId: "user_1",
      taskId: "task_2",
      status: "PENDING",
      position: null,
      completedAt: null,
      currentStressScore: 0,
    });

    // Add completed task (should be filtered out)
    store.tasks.set("task_3", {
      id: "task_3",
      title: "Completed Task 3",
      description: null,
      sksWeight: 3,
      taskWeight: 4000,
      deadlineAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      isSubTask: false,
      parentTaskId: null,
      classRoomId: null,
      creatorId: "user_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    store.userTaskProgress.set("user_1/task_3", {
      userId: "user_1",
      taskId: "task_3",
      status: "COMPLETED",
      position: null,
      completedAt: new Date(),
      currentStressScore: 0,
    });

    console.log("BEFORE GENERATING MESSAGE");
    const msg = await DailyDigestService.generateDigestMessage("user_1");
    console.log("GENERATED MESSAGE:");
    console.log(msg);

    // Verify it only counted 1 task
    if (!msg.includes("Total tugas tertunda: 1")) {
      throw new Error("Filtering failed! Msg was:\n" + msg);
    }
  });
});
