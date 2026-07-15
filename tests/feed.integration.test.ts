import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for Anonymous Feed features (Task 15.6).
 *
 * Reference: requirements.md 10.1, 10.3, 10.4, 10.6, 10.10
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
      anonymousPost: {
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

  mockDb.user.findUnique.mockImplementation(client.user.findUnique.bind(client.user));
  mockDb.user.create.mockImplementation(client.user.create.bind(client.user));
  mockDb.user.update.mockImplementation(client.user.update.bind(client.user));

  mockDb.classRoom.findUnique.mockImplementation(client.classRoom.findUnique.bind(client.classRoom));
  mockDb.classRoom.create.mockImplementation(client.classRoom.create.bind(client.classRoom));

  mockDb.classRoomMember.findUnique.mockImplementation(client.classRoomMember.findUnique.bind(client.classRoomMember));
  mockDb.classRoomMember.findMany.mockImplementation(client.classRoomMember.findMany.bind(client.classRoomMember));
  mockDb.classRoomMember.create.mockImplementation(client.classRoomMember.create.bind(client.classRoomMember));
  mockDb.classRoomMember.delete.mockImplementation(client.classRoomMember.delete.bind(client.classRoomMember));

  // Explicitly map anonymousPost methods
  mockDb.anonymousPost.findMany.mockImplementation(client.anonymousPost.findMany.bind(client.anonymousPost));
  mockDb.anonymousPost.create.mockImplementation(client.anonymousPost.create.bind(client.anonymousPost));
  mockDb.anonymousPost.delete.mockImplementation(client.anonymousPost.delete.bind(client.anonymousPost));

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

import { createFeedPostAction, getFeedPostsAction } from "@/app/actions/feed";
import { createClassRoomAction } from "@/app/actions/classroom";
import { FeedService } from "@/lib/services/feed.service";

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
    deliveryChannel: "EMAIL" as const,
    telegramChatId: null,
    createdAt: now,
    updatedAt: now,
  });
  store.usersByEmail.set(`${id}@test.example`, id);
}

describe("Anonymous Feed Integration Tests", () => {
  it("enforces complete feed post lifecycle, filtering, validation, and encryption", async () => {
    const creatorId = "creator_user";
    const otherId = "other_user";

    seedUser(creatorId);
    seedUser(otherId);

    // 1. Authenticate as creator and create classroom
    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });
    const createRes = await createClassRoomAction("CS 102", 3);
    expect(createRes.success).toBe(true);
    if (!createRes.success) throw new Error(createRes.error);
    const classRoomId = createRes.data.id;

    // 2. Test tag validation: submit post without tag
    const failTagRes = await createFeedPostAction(
      classRoomId,
      "This post is missing a tag",
      undefined as any
    );
    expect(failTagRes.success).toBe(false);
    if (failTagRes.success) throw new Error("Expected tag validation to fail");
    expect(failTagRes.error).toBe("Pilih kategori post dulu ya!");

    // 3. Test content length validation: post over 500 characters
    const longContent = "a".repeat(501);
    const failLengthRes = await createFeedPostAction(
      classRoomId,
      longContent,
      "DISKUSI_UMUM"
    );
    expect(failLengthRes.success).toBe(false);
    if (failLengthRes.success) throw new Error("Expected length validation to fail");
    expect(failLengthRes.error).toContain("500 characters");

    // 4. Test unauthorized user trying to post
    mockAuthFn.mockResolvedValue({ user: { id: otherId } });
    const failAuthRes = await createFeedPostAction(
      classRoomId,
      "Unauthorized posting attempt",
      "DISKUSI_UMUM"
    );
    expect(failAuthRes.success).toBe(false);
    if (failAuthRes.success) throw new Error("Expected unauthorized action to fail");
    expect(failAuthRes.error).toContain("member of the classroom");

    // 5. Submit valid posts as creator
    mockAuthFn.mockResolvedValue({ user: { id: creatorId } });

    // We create posts with different tags and at distinct times to verify reverse chronological order
    const post1Res = await createFeedPostAction(
      classRoomId,
      "Curhat tugas pertama",
      "CURHAT_TUGAS"
    );
    expect(post1Res.success).toBe(true);

    const post2Res = await createFeedPostAction(
      classRoomId,
      "Tanya jawaban tugas",
      "TANYA_JAWABAN"
    );
    expect(post2Res.success).toBe(true);

    const post3Res = await createFeedPostAction(
      classRoomId,
      "Diskusi umum asyik",
      "DISKUSI_UMUM"
    );
    expect(post3Res.success).toBe(true);

    // Set distinct timestamps on the posts to test reverse chronological order
    const store = getInMemoryStore();
    const postIds = Array.from(store.anonymousPosts.keys());
    const nowMs = Date.now();
    const p1 = store.anonymousPosts.get(postIds[0]!);
    const p2 = store.anonymousPosts.get(postIds[1]!);
    const p3 = store.anonymousPosts.get(postIds[2]!);
    if (p1) p1.createdAt = new Date(nowMs - 10000);
    if (p2) p2.createdAt = new Date(nowMs - 5000);
    if (p3) p3.createdAt = new Date(nowMs);

    // 6. Test authorId encryption at rest
    const dbPosts = Array.from(store.anonymousPosts.values());
    expect(dbPosts).toHaveLength(3);

    for (const dbPost of dbPosts) {
      // authorId should be encrypted using base64 and not match the raw creatorId
      expect(dbPost.encryptedAuthorId).not.toBe(creatorId);
      expect(dbPost.encryptedAuthorId).toMatch(/^[a-zA-Z0-9+/=]+$/); // base64 regex

      // Decrypt using FeedService to ensure validity
      if (!dbPost.encryptedAuthorId) throw new Error("encryptedAuthorId should not be null");
      const decrypted = FeedService.decryptAuthorId(dbPost.encryptedAuthorId);
      expect(decrypted).toBe(creatorId);
    }

    // 7. Verify reverse chronological order & full list retrieval
    const listRes = await getFeedPostsAction(classRoomId);
    expect(listRes.success).toBe(true);
    if (!listRes.success) throw new Error(listRes.error);
    expect(listRes.data).toHaveLength(3);

    // Order should be newest first (post3 -> post2 -> post1)
    expect(listRes.data[0].content).toBe("Diskusi umum asyik");
    expect(listRes.data[1].content).toBe("Tanya jawaban tugas");
    expect(listRes.data[2].content).toBe("Curhat tugas pertama");

    // 8. Test tag filtering
    const filteredRes = await getFeedPostsAction(classRoomId, "CURHAT_TUGAS");
    expect(filteredRes.success).toBe(true);
    if (!filteredRes.success) throw new Error(filteredRes.error);
    expect(filteredRes.data).toHaveLength(1);
    expect(filteredRes.data[0].content).toBe("Curhat tugas pertama");
    expect(filteredRes.data[0].tag).toBe("CURHAT_TUGAS");
  });
});
