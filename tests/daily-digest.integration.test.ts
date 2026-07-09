import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for the Daily Digest Cron and Worker Pipeline (Task 18.2).
 *
 * @tags Feature: project005-task-management-dss, Task 18.2
 *
 * Reference: tasks.md 18.2, requirements.md Requirement 13 (13.3, 13.4, 13.5, 13.6).
 *
 * Scope
 *   These tests validate the end-to-end integration flow of Daily Digest:
 *
 *     1. Cron Job Filtering: The scheduled cron job queries users with digestEnabled=true
 *        and digestTime matching current time ± 15 minutes (Requirement 13.3).
 *     2. Parallel Queue Offloading: Offloads messaging delivery for matching users to
 *        the Inngest background queue for distributed, parallel execution (Timeout Prevention).
 *     3. Idempotent Background Execution: Worker job processes event payload to trigger
 *        delivery idempotently, logging execution success/failure to DailyDigestLog
 *        (Requirement 13.4, 13.5, 13.6).
 *
 * Requirements: 13.3, 13.4, 13.5, 13.6.
 */

// ─── Mock Harness ─────────────────────────────────────────────────────────────

const mockInngestSend = vi.fn();
const mockFetch = vi.fn();

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
        count: fn(),
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
      taskEditLog: { create: fn(), createMany: fn(), findMany: fn() },
      classRoom: { findUnique: fn() },
      classRoomMember: { findUnique: fn(), findMany: fn() },
      user: { findUnique: fn(), findMany: fn(), upsert: fn() },
      dailyDigestLog: { create: fn(), update: fn() },
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

// Mock inngest client
vi.mock("@/lib/inngest", () => ({
  inngest: {
    send: async (events: any) => {
      mockInngestSend(events);
    },
  },
}));

// Service, Action, Webhook Imports
import { GET as cronHandler } from "@/app/api/webhooks/cron/route";
import { processDailyDigest } from "@/lib/inngest-functions";
import { DailyDigestService } from "@/lib/services/daily-digest.service";

const NOW = new Date("2026-06-30T12:00:00Z"); // 12:00 UTC (12:00 PM)
const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockInngestSend.mockClear();
  mockFetch.mockClear();
  global.fetch = mockFetch;
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Test Helpers ───────────────────────────────────────────────────────────

function seedUser(
  email: string,
  digestEnabled: boolean,
  digestTime: string | null,
  whatsappNumber: string | null = null,
  telegramChatId: string | null = null
): string {
  const store = getInMemoryStore();
  const id = `user_${++store.counters.user}`;
  const now = new Date();
  store.users.set(id, {
    id,
    email,
    name: id,
    passwordHash: null,
    role: "MEMBER" as const,
    locale: "EN" as const,
    digestEnabled,
    digestTime,
    deliveryChannel: whatsappNumber ? "WHATSAPP" as const : "TELEGRAM" as const,
    whatsappNumber,
    telegramChatId,
    createdAt: now,
    updatedAt: now,
  });
  store.usersByEmail.set(email.toLowerCase(), id);
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Cron Job Routing and Matching Filter (Requirement 13.3)
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 18.2.1 — Cron job routing and ±15m matching filter", () => {
  it("matches and dispatches users scheduled inside the ±15m window", async () => {
    // Current time: 12:00 PM (12:00 UTC)
    // 1. User scheduled at 12:00 PM (Matches exactly)
    const u1 = seedUser("u1@test.com", true, "12:00", "62812345");
    // 2. User scheduled at 12:15 PM (Matches: +15m)
    const u2 = seedUser("u2@test.com", true, "12:15", "62812346");
    // 3. User scheduled at 11:45 AM (Matches: -15m)
    const u3 = seedUser("u3@test.com", true, "11:45", "62812347");
    // 4. User scheduled at 12:16 PM (No match: +16m)
    seedUser("u4@test.com", true, "12:16", "62812348");
    // 5. User scheduled at 12:00 PM but disabled (No match)
    seedUser("u5@test.com", false, "12:00", "62812349");

    const response = await cronHandler(new Request("http://localhost/api/webhooks/cron?type=digest"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.dispatchedCount).toBe(3); // u1, u2, u3 should match

    // Check Inngest dispatch
    expect(mockInngestSend).toHaveBeenCalled();
    const events = mockInngestSend.mock.calls[0]![0];
    expect(events.length).toBe(3);

    const dispatchedIds = events.map((e: any) => e.data.userId);
    expect(dispatchedIds).toContain(u1);
    expect(dispatchedIds).toContain(u2);
    expect(dispatchedIds).toContain(u3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Worker Execution & Idempotent Log Logging (Requirement 13.4, 13.5, 13.6)
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 18.2.2 — Background worker execution and idempotency logging", () => {
  it("delivers successfully on first run and logs SENT to DailyDigestLog", async () => {
    const userId = seedUser("deliver@test.com", true, "12:00", null, "123456");

    // Stub external API delivery
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    // Execute the Inngest handler steps directly via the service or simulate Inngest run.
    // Inngest testing helpers/directly invoking standard service logic:
    await DailyDigestService.attemptIdempotentDelivery(userId, NOW);

    // Verify WhatsApp/Telegram API endpoint was hit
    expect(mockFetch).toHaveBeenCalled();
    expect(mockFetch.mock.calls[0]![0]).toContain("telegram");

    // Verify DailyDigestLog shows SENT in the database
    const store = getInMemoryStore();
    const todayStr = new Date(Date.UTC(2026, 5, 30)).toISOString();
    const log = store.dailyDigestLogs.get(`${userId}/${todayStr}`);
    expect(log).toBeDefined();
    expect(log?.deliveryStatus).toBe("SENT");
    expect(log?.errorMessage).toBeNull();
  });

  it("prevents duplicate deliveries for the same user on the same date (Idempotency Key)", async () => {
    const userId = seedUser("duplicate@test.com", true, "12:00", null, "123456");

    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    // Run first delivery
    await DailyDigestService.attemptIdempotentDelivery(userId, NOW);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Reset fetch mock to verify if second attempt triggers API delivery
    mockFetch.mockClear();

    // Run second delivery on the same day
    await DailyDigestService.attemptIdempotentDelivery(userId, NOW);

    // API delivery should NOT trigger due to database uniqueness constraint on [userId, digestDate]
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("updates log status to FAILED and stores error message on external API failures", async () => {
    const userId = seedUser("fail@test.com", true, "12:00", null, "123456");

    // Stub external API to return internal server error (fails WhatsApp/Telegram bot)
    mockFetch.mockResolvedValue(new Response("API Failure Details", { status: 500 }));

    await expect(DailyDigestService.attemptIdempotentDelivery(userId, NOW)).rejects.toThrow();

    // Check database log shows FAILED and contains error message
    const store = getInMemoryStore();
    const todayStr = new Date(Date.UTC(2026, 5, 30)).toISOString();
    const log = store.dailyDigestLogs.get(`${userId}/${todayStr}`);
    expect(log).toBeDefined();
    expect(log?.deliveryStatus).toBe("FAILED");
    expect(log?.errorMessage).toBeDefined();
  });
});
