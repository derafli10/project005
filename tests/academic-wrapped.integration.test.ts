import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for the Academic Wrapped weekly card system (Task 17.5).
 *
 * @tags Feature: project005-task-management-dss, Task 17.5
 *
 * Reference: tasks.md 17.5, requirements.md Requirement 11 (11.1, 11.2, 11.3, 11.4).
 *
 * Scope
 *   These tests validate the end-to-end integration flow of Academic Wrapped:
 *
 *     1. Week Stats Calculation: Sum of completed taskWeight (totalSavedCredits),
 *        completed count, streak, and highest CookedTier from snapshots (Requirement 11.2).
 *     2. PNG Generation Dimensions: The satori-based render pipeline utilizes
 *        the correct 1080x1920 layout dimensions (Requirement 11.3).
 *     3. CDN Upload and URL Persistence: Uploads generated card to Vercel Blob
 *        and saves the record with the returned public URL (Requirement 11.7, 11.10).
 *     4. Cron and Worker Pipeline: scheduled cron job triggers user chunking and
 *        offloads event payload for background queue worker distribution (Requirement 11.1, 11.8).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.7, 11.8, 11.10.
 */

// ─── Mock Harness ─────────────────────────────────────────────────────────────

const mockImageResponseConstructor = vi.fn();
const mockPut = vi.fn();
const mockInngestSend = vi.fn();

const { mockDb } = vi.hoisted(() => {
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
        findFirst: fn(),
        findMany: fn(),
        create: fn(),
        createMany: fn(),
        update: fn(),
      },
      cookedScore: {
        findMany: fn(),
        upsert: fn(),
      },
      academicWrapped: {
        findMany: fn(),
        upsert: fn(),
      },
      taskOverride: { create: fn() },
      taskEditLog: { create: fn(), createMany: fn() },
      classRoom: { findUnique: fn() },
      classRoomMember: { findUnique: fn(), findMany: fn() },
      user: { findUnique: fn(), findMany: fn(), upsert: fn() },
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

// Mock @vercel/og to avoid fetch and WASM rendering overhead in node.
vi.mock("@vercel/og", () => {
  class MockImageResponse {
    options: any;
    constructor(element: any, options: any) {
      mockImageResponseConstructor(element, options);
      this.options = options;
    }
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  }
  return {
    ImageResponse: MockImageResponse,
  };
});

// Mock @vercel/blob for CDN upload.
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: any, options: any) => {
    mockPut(pathname, body, options);
    return { url: `https://blob.vercel-storage.com/${pathname}` };
  },
}));

// Mock inngest client.
vi.mock("@/lib/inngest", () => ({
  inngest: {
    send: async (events: any) => {
      mockInngestSend(events);
    },
  },
}));

// Service & handler imports.
import { AcademicWrappedService } from "@/lib/services/academic-wrapped.service";
import { GET as cronHandler } from "@/app/api/webhooks/cron/route";

const NOW = new Date("2026-06-30T12:00:00Z"); // Tuesday
const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockImageResponseConstructor.mockClear();
  mockPut.mockClear();
  mockInngestSend.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Test Helpers ───────────────────────────────────────────────────────────

function seedUser(idOverride?: string): string {
  const store = getInMemoryStore();
  const id = idOverride ?? `user_${++store.counters.user}`;
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
    deliveryChannel: "EMAIL" as const,
    telegramChatId: null,
    createdAt: now,
    updatedAt: now,
  });
  store.usersByEmail.set(`${id}@test.example`, id);
  return id;
}

function seedCompletedTask(
  userId: string,
  taskWeight: number,
  completedAt: Date
): void {
  const store = getInMemoryStore();
  const taskId = `task_${++store.counters.task}`;

  store.tasks.set(taskId, {
    id: taskId,
    title: `Task ${taskId}`,
    description: null,
    sksWeight: 3,
    taskWeight,
    deadlineAt: new Date(completedAt.getTime() + MS_PER_DAY),
    isSubTask: false,
    parentTaskId: null,
    classRoomId: null,
    creatorId: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  store.userTaskProgress.set(`${userId}/${taskId}`, {
    userId,
    taskId,
    status: "COMPLETED",
    position: null,
    completedAt,
    currentStressScore: 0,
  });
}

function seedCookedScore(
  userId: string,
  date: Date,
  tier: "MAIN_CHARACTER" | "LET_HIM_COOK" | "SLIGHTLY_COOKED" | "OVERCOOKED"
): void {
  const store = getInMemoryStore();
  const id = `cs_${++store.counters.cookedScore}`;
  const dateISO = date.toISOString().slice(0, 10);
  store.cookedScores.set(`${userId}/${dateISO}`, {
    id,
    userId,
    date,
    cumulativeScore: 5000,
    tier,
    createdAt: new Date(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Week Stats Calculation (Requirement 11.2, 11.4)
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 17.5.1 — Week stats calculation", () => {
  it("calculates weekly stats correctly: saved credits, task count, highest tier, and streak", async () => {
    const userId = seedUser();
    // Monday of target week
    const targetMonday = new Date(Date.UTC(2026, 5, 22, 0, 0, 0, 0)); // 2026-06-22

    // Seed tasks inside target week (Mon, Wed, Fri)
    seedCompletedTask(userId, 1500, new Date(Date.UTC(2026, 5, 22, 10, 0, 0))); // Monday
    seedCompletedTask(userId, 2500, new Date(Date.UTC(2026, 5, 24, 14, 0, 0))); // Wednesday
    seedCompletedTask(userId, 3000, new Date(Date.UTC(2026, 5, 26, 16, 0, 0))); // Friday

    // Seed task outside the target week (previous Sunday)
    seedCompletedTask(userId, 9000, new Date(Date.UTC(2026, 5, 21, 23, 0, 0)));

    // Seed daily CookedScore snapshots for highest tier check
    seedCookedScore(userId, new Date(Date.UTC(2026, 5, 22)), "MAIN_CHARACTER");
    seedCookedScore(userId, new Date(Date.UTC(2026, 5, 24)), "SLIGHTLY_COOKED");
    seedCookedScore(userId, new Date(Date.UTC(2026, 5, 25)), "LET_HIM_COOK");

    const stats = await AcademicWrappedService.calculateWeekStats(userId, targetMonday);

    // Total saved credits = 1500 + 2500 + 3000 = 7000 basis points
    expect(stats.totalSavedCredits).toBe(7000);
    // Tasks completed = 3 (Mon, Wed, Fri)
    expect(stats.tasksCompleted).toBe(3);
    // Highest tier reached = SLIGHTLY_COOKED (out of MAIN_CHARACTER, SLIGHTLY_COOKED, LET_HIM_COOK)
    expect(stats.highestTier).toBe("SLIGHTLY_COOKED");
    // Streak = 1 (no consecutive days of completions)
    expect(stats.streak).toBe(1);
  });

  it("calculates streak correctly for consecutive days", async () => {
    const userId = seedUser();
    const targetMonday = new Date(Date.UTC(2026, 5, 22, 0, 0, 0, 0)); // 2026-06-22

    // Seed consecutive days (Wed, Thu, Fri)
    seedCompletedTask(userId, 1000, new Date(Date.UTC(2026, 5, 24, 10, 0, 0))); // Wed
    seedCompletedTask(userId, 1000, new Date(Date.UTC(2026, 5, 25, 10, 0, 0))); // Thu
    seedCompletedTask(userId, 1000, new Date(Date.UTC(2026, 5, 26, 10, 0, 0))); // Fri

    const stats = await AcademicWrappedService.calculateWeekStats(userId, targetMonday);
    expect(stats.streak).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PNG Generation with Correct Dimensions (Requirement 11.3)
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 17.5.2 — PNG Generation with correct dimensions (1080x1920)", () => {
  it("renders card using @vercel/og with width 1080 and height 1920", async () => {
    const targetMonday = new Date(Date.UTC(2026, 5, 22, 0, 0, 0, 0));
    const stats = {
      totalSavedCredits: 5000,
      tasksCompleted: 4,
      highestTier: "LET_HIM_COOK" as const,
      streak: 3,
    };

    // We stub font loading so the test doesn't try to fetch from google fonts
    vi.spyOn(global, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(new ArrayBuffer(8)))
    );

    await AcademicWrappedService.renderCard(stats, "Test Student", targetMonday);

    expect(mockImageResponseConstructor).toHaveBeenCalled();
    const options = mockImageResponseConstructor.mock.calls[0]![1];
    expect(options.width).toBe(1080);
    expect(options.height).toBe(1920);
    expect(options.fonts).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CDN Upload and URL Return (Requirement 11.7, 11.10)
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 17.5.3 — CDN upload and URL return", () => {
  it("uploads to Vercel Blob and returns correct URL shape", async () => {
    const userId = seedUser();
    const targetMonday = new Date(Date.UTC(2026, 5, 22, 0, 0, 0, 0));
    const dummyBuffer = Buffer.from("dummy-png-data");

    const url = await AcademicWrappedService.uploadToCDN(dummyBuffer, userId, targetMonday);

    expect(mockPut).toHaveBeenCalled();
    const [pathname, body, options] = mockPut.mock.calls[0]!;

    // Check pathname structure matches requirement
    expect(pathname).toContain(`wrapped/${userId}/2026-06-22.png`);
    expect(body).toBe(dummyBuffer);
    expect(options.access).toBe("public");
    expect(options.contentType).toBe("image/png");
    expect(url).toBe(`https://blob.vercel-storage.com/${pathname}`);
  });

  it("orchestrates stats computation, CDN upload, and persists record to DB", async () => {
    const userId = seedUser();
    const targetMonday = new Date(Date.UTC(2026, 5, 22, 0, 0, 0, 0));

    // Seed tasks & snapshots
    seedCompletedTask(userId, 6000, new Date(Date.UTC(2026, 5, 23, 10, 0, 0))); // Tuesday
    seedCookedScore(userId, new Date(Date.UTC(2026, 5, 23)), "LET_HIM_COOK");

    // Stub renderCard to avoid external fetch calls during end-to-end service test
    vi.spyOn(AcademicWrappedService, "renderCard").mockResolvedValue(Buffer.from("dummy-png"));

    const record = await AcademicWrappedService.generateAndSave(userId, "Student", targetMonday);

    expect(record.userId).toBe(userId);
    expect(record.imageUrl).toContain(`wrapped/${userId}/2026-06-22.png`);
    expect(record.totalSavedCredits).toBe(6000);
    expect(record.tasksCompleted).toBe(1);
    expect(record.highestTier).toBe("LET_HIM_COOK");

    // Verify it is saved in the database
    const store = getInMemoryStore();
    const normalizedDateStr = new Date(Date.UTC(2026, 5, 22)).toISOString();
    const saved = store.academicWrapped.get(`${userId}/${normalizedDateStr}`);
    expect(saved).toBeDefined();
    expect(saved?.totalSavedCredits).toBe(6000);
    expect(saved?.imageUrl).toBe(record.imageUrl);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Cron Job Execution and Worker Distribution Pipeline (Requirement 11.1, 11.8)
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 17.5.4 — Cron job execution and worker distribution pipeline", () => {
  it("scheduled cron job finds all users and dispatches Inngest trigger events", async () => {
    // Seed multiple users
    const u1 = seedUser();
    const u2 = seedUser();

    // Trigger scheduled cron handler
    const response = await cronHandler(new Request("http://localhost/api/webhooks/cron"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.dispatchedCount).toBe(2);

    // Verify events sent to Inngest for parallel background processing
    expect(mockInngestSend).toHaveBeenCalled();
    const events = mockInngestSend.mock.calls[0]![0];
    expect(events.length).toBe(2);

    // Verify event structure
    expect(events[0].name).toBe("app/wrapped.process");
    expect(events[0].data.userId).toBe(u1);
    expect(events[1].data.userId).toBe(u2);
  });
});
