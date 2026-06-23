import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Property-based tests for the Feed Service.
 *
 * @tags Feature: project005-anonymous-feed, Property 19, Property 20
 *
 * Reference: design.md > Correctness Properties 19–20, Requirements 10.1, 10.2, 10.3, 10.4, 10.10.
 */

// ─── Mock: vi.hoisted ensures the stubs exist before the hoisted vi.mock ────

const { mockDb } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      classRoomMember: { findUnique: fn(), findMany: fn(), create: fn(), delete: fn() },
      classRoom: { findUnique: fn(), create: fn() },
      anonymousPost: { create: fn(), findMany: fn(), delete: fn() },
      $transaction: fn(),
    },
  };
});

let client: ReturnType<typeof buildInMemoryClient>;

/**
 * Recursively bind each `vi.fn()` stub in `mockDb` to the matching method on
 * the freshly-built in-memory client. The shared structure (top-level models
 * + nested method objects) is mirrored on both sides.
 */
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
import { FeedService } from "@/lib/services/feed.service";
import {
  AuthorizationError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import type { PostTag } from "@/generated/prisma";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
  classCounter = 0;
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Register a user directly in the in-memory store and return the id. */
function seedUser(idOverride?: string): string {
  const store = getInMemoryStore();
  const id = idOverride ?? `user_${++store.counters.user}`;
  const now = new Date();
  const user = {
    id,
    email: `${id}@test.example`,
    name: id,
    passwordHash: null,
    role: "MEMBER" as const,
    locale: "EN" as const,
    createdAt: now,
    updatedAt: now,
  };
  store.users.set(id, user);
  store.usersByEmail.set(user.email, id);
  return id;
}

/**
 * Generate a CUID-compatible id for test classrooms.
 * CUIDs match /^c[a-z0-9]{24}$/ — we produce a deterministic one from a counter.
 */
let classCounter = 0;
function fakeCuid(): string {
  const counter = (++classCounter).toString(36).padStart(24, "0");
  return `c${counter}`;
}

/** Create a classroom and optionally enroll members. Returns classRoom id. */
function seedClassRoom(creatorId: string, memberIds: string[] = []): string {
  const store = getInMemoryStore();
  const id = fakeCuid();
  const classCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  const classRoom = {
    id,
    className: "Test ClassRoom",
    classCode,
    sksWeight: 3,
    creatorId,
    createdAt: new Date(),
  };
  store.classRooms.set(id, classRoom);
  store.classRoomsByCode.set(classCode, id);

  // Enroll creator as a member
  const creatorKey = `${id}/${creatorId}`;
  store.classRoomMembers.set(creatorKey, {
    classRoomId: id,
    userId: creatorId,
    joinedAt: new Date(),
  });

  // Enroll additional members
  for (const memberId of memberIds) {
    const key = `${id}/${memberId}`;
    store.classRoomMembers.set(key, {
      classRoomId: id,
      userId: memberId,
      joinedAt: new Date(),
    });
  }

  return id;
}

/** Seed an anonymous post directly in the in-memory store with a specific createdAt. */
function seedAnonymousPost(
  classRoomId: string,
  content: string,
  tag: "CURHAT_TUGAS" | "BUTUH_TEMAN_TIM" | "TANYA_JAWABAN" | "DISKUSI_UMUM",
  createdAt: Date,
  encryptedAuthorId: string = "encrypted-stub"
): string {
  const store = getInMemoryStore();
  const id = `post_${++store.counters.anonymousPost}`;
  store.anonymousPosts.set(id, {
    id,
    classRoomId,
    encryptedAuthorId,
    content,
    tag,
    createdAt,
  });
  return id;
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Valid PostTag enum values. */
const VALID_TAGS: PostTag[] = [
  "CURHAT_TUGAS",
  "BUTUH_TEMAN_TIM",
  "TANYA_JAWABAN",
  "DISKUSI_UMUM",
];

/** Arbitrary for valid PostTag values. */
const validTagArb = fc.constantFrom<PostTag>(...VALID_TAGS);

/** Content string: 1–500 non-empty chars. */
const contentArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length >= 1);

/** Short content for speed. */
const shortContentArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length >= 1);

/** Content that exceeds 500 chars. */
const overflowContentArb = fc
  .string({ minLength: 501, maxLength: 600 })
  .filter((s) => s.trim().length >= 501);

/** Arbitrary for invalid (non-PostTag) strings. */
const invalidTagArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter(
    (s) =>
      !VALID_TAGS.includes(s as PostTag) &&
      s.trim().length > 0
  );

/** Arbitrary for a Date with an offset in seconds from a base. */
const timestampOffsetArb = fc.integer({ min: 0, max: 365 * 24 * 3600 });

// ─── Property 19: Post Submission Requires Tag Selection ────────────────────

describe("Property 19: Post Submission Requires Tag Selection", () => {
  it("rejects post creation when tag is not a valid PostTag enum value", async () => {
    const prop = fc.asyncProperty(
      shortContentArb,
      invalidTagArb,
      async (content, invalidTag) => {
        resetInMemoryDb();
        hydrateMock();

        const userId = seedUser();
        const classRoomId = seedClassRoom(userId);

        await expect(
          FeedService.createAnonymousPost(
            userId,
            classRoomId,
            content,
            invalidTag as PostTag
          )
        ).rejects.toThrow(ValidationError);
      }
    );
    await fc.assert(prop, { numRuns: 25, maxSkipsPerRun: 100 });
  });

  it("rejects post creation with an empty tag (empty string)", async () => {
    const userId = seedUser();
    const classRoomId = seedClassRoom(userId);

    await expect(
      FeedService.createAnonymousPost(
        userId,
        classRoomId,
        "Hello world",
        "" as PostTag
      )
    ).rejects.toThrow(ValidationError);
  });

  it("accepts post creation when a valid tag is provided", async () => {
    const prop = fc.asyncProperty(
      shortContentArb,
      validTagArb,
      async (content, tag) => {
        resetInMemoryDb();
        hydrateMock();

        const userId = seedUser();
        const classRoomId = seedClassRoom(userId);

        const post = await FeedService.createAnonymousPost(
          userId,
          classRoomId,
          content,
          tag
        );

        expect(post).toBeDefined();
        expect(post.tag).toBe(tag);
        expect(post.classRoomId).toBe(classRoomId);
        expect(post.content).toBe(content.trim());
      }
    );
    await fc.assert(prop, { numRuns: 25, maxSkipsPerRun: 100 });
  });

  it("rejects post creation when content exceeds 500 characters", async () => {
    const prop = fc.asyncProperty(
      overflowContentArb,
      validTagArb,
      async (longContent, tag) => {
        resetInMemoryDb();
        hydrateMock();

        const userId = seedUser();
        const classRoomId = seedClassRoom(userId);

        await expect(
          FeedService.createAnonymousPost(userId, classRoomId, longContent, tag)
        ).rejects.toThrow(ValidationError);
      }
    );
    await fc.assert(prop, { numRuns: 15, maxSkipsPerRun: 100 });
  });

  it("returns validation error with message 'Pilih kategori post dulu ya!' for invalid tag", async () => {
    const userId = seedUser();
    const classRoomId = seedClassRoom(userId);

    try {
      await FeedService.createAnonymousPost(
        userId,
        classRoomId,
        "Test content",
        "NOT_A_TAG" as PostTag
      );
      // Should not reach here
      expect.unreachable("Expected ValidationError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toBe(
        "Pilih kategori post dulu ya!"
      );
    }
  });
});

// ─── Property 20: Feed Post Reverse Chronological Ordering ──────────────────

describe("Property 20: Feed Post Reverse Chronological Ordering", () => {
  it("returns posts ordered by createdAt DESC (newest first)", async () => {
    const prop = fc.asyncProperty(
      fc.array(timestampOffsetArb, { minLength: 2, maxLength: 15 }),
      async (offsets) => {
        resetInMemoryDb();
        hydrateMock();

        const userId = seedUser();
        const classRoomId = seedClassRoom(userId);
        const baseTime = new Date("2026-01-01T00:00:00Z");

        // Seed posts with varying timestamps (deliberately unordered)
        for (const offset of offsets) {
          const createdAt = new Date(baseTime.getTime() + offset * 1000);
          seedAnonymousPost(classRoomId, `Post at ${offset}s`, "DISKUSI_UMUM", createdAt);
        }

        const posts = await FeedService.getFeedPosts(userId, classRoomId);

        // Verify reverse chronological order: each post's createdAt >= next post's createdAt
        for (let i = 1; i < posts.length; i++) {
          const prevTime = (posts[i - 1]!.createdAt as Date).getTime();
          const currTime = (posts[i]!.createdAt as Date).getTime();
          expect(prevTime).toBeGreaterThanOrEqual(currTime);
        }
      }
    );
    await fc.assert(prop, { numRuns: 25, maxSkipsPerRun: 50 });
  });

  it("correctly filters posts by tag while maintaining reverse chronological order", async () => {
    const prop = fc.asyncProperty(
      validTagArb,
      fc.array(
        fc.tuple(validTagArb, timestampOffsetArb),
        { minLength: 3, maxLength: 10 }
      ),
      async (filterTag, postSpecs) => {
        resetInMemoryDb();
        hydrateMock();

        const userId = seedUser();
        const classRoomId = seedClassRoom(userId);
        const baseTime = new Date("2026-01-01T00:00:00Z");

        // Seed posts with mixed tags
        for (const [tag, offset] of postSpecs) {
          const createdAt = new Date(baseTime.getTime() + offset * 1000);
          seedAnonymousPost(classRoomId, `Post tag=${tag}`, tag, createdAt);
        }

        const posts = await FeedService.getFeedPosts(userId, classRoomId, filterTag);

        // All returned posts must match the filter tag
        for (const post of posts) {
          expect(post.tag).toBe(filterTag);
        }

        // Posts must still be in reverse chronological order
        for (let i = 1; i < posts.length; i++) {
          const prevTime = (posts[i - 1]!.createdAt as Date).getTime();
          const currTime = (posts[i]!.createdAt as Date).getTime();
          expect(prevTime).toBeGreaterThanOrEqual(currTime);
        }

        // Count should match manually filtered count
        const expectedCount = postSpecs.filter(([tag]) => tag === filterTag).length;
        expect(posts.length).toBe(expectedCount);
      }
    );
    await fc.assert(prop, { numRuns: 25, maxSkipsPerRun: 50 });
  });

  it("returns an empty array when no posts exist", async () => {
    const userId = seedUser();
    const classRoomId = seedClassRoom(userId);

    const posts = await FeedService.getFeedPosts(userId, classRoomId);
    expect(posts).toEqual([]);
  });
});

// ─── Classroom Membership Enforcement ───────────────────────────────────────

describe("Classroom Membership Enforcement", () => {
  it("rejects post creation from a non-member", async () => {
    const prop = fc.asyncProperty(
      shortContentArb,
      validTagArb,
      async (content, tag) => {
        resetInMemoryDb();
        hydrateMock();

        const creator = seedUser();
        const nonMember = seedUser();
        const classRoomId = seedClassRoom(creator); // nonMember is NOT enrolled

        await expect(
          FeedService.createAnonymousPost(nonMember, classRoomId, content, tag)
        ).rejects.toThrow(AuthorizationError);
      }
    );
    await fc.assert(prop, { numRuns: 15, maxSkipsPerRun: 50 });
  });

  it("rejects feed retrieval from a non-member", async () => {
    const creator = seedUser();
    const nonMember = seedUser();
    const classRoomId = seedClassRoom(creator); // nonMember is NOT enrolled

    await expect(
      FeedService.getFeedPosts(nonMember, classRoomId)
    ).rejects.toThrow(AuthorizationError);
  });

  it("allows post creation and retrieval for enrolled members", async () => {
    const creator = seedUser();
    const member = seedUser();
    const classRoomId = seedClassRoom(creator, [member]);

    // Member can create a post
    const post = await FeedService.createAnonymousPost(
      member,
      classRoomId,
      "Member post content",
      "DISKUSI_UMUM"
    );
    expect(post).toBeDefined();
    expect(post.classRoomId).toBe(classRoomId);

    // Member can retrieve posts
    const posts = await FeedService.getFeedPosts(member, classRoomId);
    expect(posts.length).toBe(1);
  });

  it("returns the correct AuthorizationError message for non-members creating posts", async () => {
    const creator = seedUser();
    const nonMember = seedUser();
    const classRoomId = seedClassRoom(creator);

    try {
      await FeedService.createAnonymousPost(
        nonMember,
        classRoomId,
        "Unauthorized post",
        "DISKUSI_UMUM"
      );
      expect.unreachable("Expected AuthorizationError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).message).toBe(
        "User must be a member of the classroom to post in its feed."
      );
    }
  });

  it("returns the correct AuthorizationError message for non-members viewing feed", async () => {
    const creator = seedUser();
    const nonMember = seedUser();
    const classRoomId = seedClassRoom(creator);

    try {
      await FeedService.getFeedPosts(nonMember, classRoomId);
      expect.unreachable("Expected AuthorizationError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).message).toBe(
        "User must be a member of the classroom to view its feed."
      );
    }
  });
});

// ─── Author ID Encryption / Decryption ──────────────────────────────────────

describe("Author ID Encryption and Decryption", () => {
  it("encrypts and decrypts authorId back to the original userId (round-trip)", async () => {
    const prop = fc.asyncProperty(
      fc.uuid(),
      async (userId) => {
        const keyPair = FeedService.generateRsaKeyPair();

        const encrypted = FeedService.encryptAuthorId(userId, keyPair.publicKey);

        // Encrypted text must not equal the original userId
        expect(encrypted).not.toBe(userId);

        // Decryption must recover the original userId
        const decrypted = FeedService.decryptAuthorId(encrypted, keyPair.privateKey);
        expect(decrypted).toBe(userId);
      }
    );
    await fc.assert(prop, { numRuns: 10 }); // RSA keygen is slow, keep runs small
  });

  it("produces different ciphertext for the same userId across calls (non-deterministic)", () => {
    const keyPair = FeedService.generateRsaKeyPair();
    const userId = "user_test_determinism_check";

    const encrypted1 = FeedService.encryptAuthorId(userId, keyPair.publicKey);
    const encrypted2 = FeedService.encryptAuthorId(userId, keyPair.publicKey);

    // RSA-OAEP uses random padding → ciphertexts should differ
    expect(encrypted1).not.toBe(encrypted2);

    // Both must still decrypt to the same original userId
    expect(FeedService.decryptAuthorId(encrypted1, keyPair.privateKey)).toBe(userId);
    expect(FeedService.decryptAuthorId(encrypted2, keyPair.privateKey)).toBe(userId);
  });

  it("stores encrypted authorId in the database record on post creation", async () => {
    const userId = seedUser();
    const classRoomId = seedClassRoom(userId);

    const post = await FeedService.createAnonymousPost(
      userId,
      classRoomId,
      "Check encryption storage",
      "CURHAT_TUGAS"
    );

    // The encryptedAuthorId must be a non-empty string
    expect(post.encryptedAuthorId).toBeDefined();
    expect(typeof post.encryptedAuthorId).toBe("string");
    expect((post.encryptedAuthorId as string).length).toBeGreaterThan(0);

    // It must not be the raw userId
    expect(post.encryptedAuthorId).not.toBe(userId);
  });

  it("throws when attempting to decrypt without a private key", () => {
    // Clear fallback key pair by directly setting it (simulate fresh environment)
    const keyPair = FeedService.generateRsaKeyPair();
    const encrypted = FeedService.encryptAuthorId("user_no_key", keyPair.publicKey);

    // Attempting decryption with an undefined key should throw
    expect(() =>
      FeedService.decryptAuthorId(encrypted, undefined as unknown as string)
    ).toThrow();
  });
});
