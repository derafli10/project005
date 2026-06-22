import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import bcrypt from "bcryptjs";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Property-based tests for the Authentication Service.
 *
 * @tags Feature: project005-task-management-dss, Property 1, Property 2, Property 3, Property 4
 *
 * Reference: design.md > Correctness Properties 1–4, Requirements 1.1–1.8.
 */

// ─── Mock: vi.hoisted ensures the stubs exist before the hoisted vi.mock ────

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    session: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
}));

let client: ReturnType<typeof buildInMemoryClient>;

function hydrateMock() {
  client = buildInMemoryClient();
  mockDb.user.findUnique.mockImplementation(client.user.findUnique.bind(client.user));
  mockDb.user.create.mockImplementation(client.user.create.bind(client.user));
  mockDb.session.findUnique.mockImplementation(client.session.findUnique.bind(client.session));
  mockDb.session.create.mockImplementation(client.session.create.bind(client.session));
  mockDb.session.delete.mockImplementation(client.session.delete.bind(client.session));
}

vi.mock("@/lib/db", () => ({
  db: mockDb,
  baseDb: mockDb,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

// Service imports MUST come after vi.mock declarations.
import { AuthService } from "@/lib/services/auth.service";
import { ConflictError, AuthenticationError } from "@/lib/errors/domain-errors";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
  vi.clearAllMocks();
});

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** A valid email using UUID local-part to guarantee uniqueness across iterations. */
const validEmailArb = fc.uuid().map((uuid) => `${uuid}@test.example`);

/**
 * Build an arbitrary that produces a string of length `len` using only the
 * characters in `alphabet`. fast-check v3.22+ removed `charset` from
 * `StringConstraints`, so we compose the string from `mapToConstant`.
 */
function stringFromAlphabet(
  alphabet: string,
  minLength: number,
  maxLength: number
): fc.Arbitrary<string> {
  const charEntries = alphabet.split("").map((c) => ({
    num: 1,
    build: () => c,
  }));
  return fc
    .array(fc.mapToConstant(...charEntries), { minLength, maxLength })
    .map((chars) => chars.join(""));
}

/**
 * A valid password ≥ 8 chars with at least one letter, one number, one special.
 * Alphanumeric + `!@#$%`.
 */
const validPasswordArb = stringFromAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%",
  8,
  64
).filter(
  (p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p)
);

/** A valid name ≥ 2 chars (letters + spaces). */
const validNameArb = stringFromAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ",
  2,
  64
).filter((n) => n.trim().length >= 2);

// ─── Property 1: Registration with Valid Credentials Creates Account ───────

describe("Property 1: Registration with Valid Credentials Creates Account", () => {
  it("returns a user (without passwordHash) for any valid email + password + name", async () => {
    await fc.assert(
      fc.asyncProperty(validEmailArb, validPasswordArb, validNameArb,
        async (email, password, name) => {
          const user = await AuthService.register(email, password, name);

          expect(user).toBeDefined();
          expect(user.email).toBe(email.toLowerCase());
          expect(user.name).toBe(name.trim());
          expect((user as Record<string, unknown>).passwordHash).toBeUndefined();
          expect(user.id).toBeDefined();

          // The password must have been hashed (not stored in plaintext).
          const store = getInMemoryStore();
          const stored = store.users.get(user.id);
          expect(stored).toBeDefined();
          if (stored) {
            expect(stored.passwordHash).not.toBe(password);
            expect(
              await bcrypt.compare(password, stored.passwordHash ?? "")
            ).toBe(true);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Property 2: Duplicate Email Registration is Rejected ──────────────────

describe("Property 2: Duplicate Email Registration is Rejected", () => {
  it("throws ConflictError when the email already exists", async () => {
    await fc.assert(
      fc.asyncProperty(validEmailArb, validPasswordArb, validNameArb,
        async (email, password, name) => {
          await AuthService.register(email, password, name);

          await expect(
            AuthService.register(email, "DifferentP@ssw0rd!", name)
          ).rejects.toThrow(ConflictError);
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ─── Property 3: Valid Login Creates Session Token ─────────────────────────

describe("Property 3: Valid Login Creates Session Token", () => {
  it("returns a sessionToken after registering and logging in", async () => {
    await fc.assert(
      fc.asyncProperty(validEmailArb, validPasswordArb, validNameArb,
        async (email, password, name) => {
          const user = await AuthService.register(email, password, name);
          const result = await AuthService.login(email, password);

          expect(result.sessionToken).toBeTruthy();
          expect(typeof result.sessionToken).toBe("string");
          expect(result.user.id).toBe(user.id);

          const store = getInMemoryStore();
          const session = store.sessions.get(result.sessionToken);
          expect(session).toBeDefined();
          if (session) {
            expect(session.userId).toBe(user.id);
            const ttlDays =
              (session.expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
            expect(ttlDays).toBeGreaterThan(29);
            expect(ttlDays).toBeLessThan(31);
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ─── Property 4: Invalid Login is Rejected ─────────────────────────────────

describe("Property 4: Invalid Login is Rejected", () => {
  it("throws AuthenticationError for wrong password", async () => {
    await fc.assert(
      fc.asyncProperty(validEmailArb, validPasswordArb, validNameArb, validPasswordArb,
        async (email, correctPassword, name, wrongPassword) => {
          fc.pre(correctPassword !== wrongPassword);

          await AuthService.register(email, correctPassword, name);

          await expect(
            AuthService.login(email, wrongPassword)
          ).rejects.toThrow(AuthenticationError);
        }
      ),
      { numRuns: 30 }
    );
  });

  it("throws AuthenticationError for a non-existent email", async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        validPasswordArb,
        async (email, password) => {
          // No user is registered with this email — login must fail.
          await expect(
            AuthService.login(email, password)
          ).rejects.toThrow(AuthenticationError);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─── Session validation ────────────────────────────────────────────────────

describe("AuthService.validateSession", () => {
  it("returns the user for a valid session token", async () => {
    const email = "user@test.org";
    const password = "Str0ng!Pass";
    await AuthService.register(email, password, "Test User");
    const { sessionToken, user } = await AuthService.login(email, password);

    const validated = await AuthService.validateSession(sessionToken);
    expect(validated).not.toBeNull();
    expect(validated!.id).toBe(user.id);
    expect(validated!.email).toBe(email.toLowerCase());
  });

  it("returns null for an invalid session token", async () => {
    const result = await AuthService.validateSession("nonexistent-token");
    expect(result).toBeNull();
  });

  it("returns null and destroys an expired session (Requirement 1.9)", async () => {
    const email = "expire@test.org";
    const password = "Str0ng!Pass";
    await AuthService.register(email, password, "Expire Test");
    const { sessionToken } = await AuthService.login(email, password);

    const store = getInMemoryStore();
    const session = store.sessions.get(sessionToken);
    if (session) {
      session.expires = new Date(Date.now() - 1000);
    }

    const result = await AuthService.validateSession(sessionToken);
    expect(result).toBeNull();
    expect(store.sessions.has(sessionToken)).toBe(false);
  });
});

// ─── Logout ────────────────────────────────────────────────────────────────

describe("AuthService.logout", () => {
  it("destroys the session (Requirement 1.8)", async () => {
    const email = "logout@test.org";
    const password = "Str0ng!Pass";
    await AuthService.register(email, password, "Logout Test");
    const { sessionToken } = await AuthService.login(email, password);

    await AuthService.logout(sessionToken);

    const result = await AuthService.validateSession(sessionToken);
    expect(result).toBeNull();
  });

  it("is idempotent — calling logout twice does not throw", async () => {
    const email = "idem@test.org";
    const password = "Str0ng!Pass";
    await AuthService.register(email, password, "Idempotent Test");
    const { sessionToken } = await AuthService.login(email, password);

    await AuthService.logout(sessionToken);
    await expect(AuthService.logout(sessionToken)).resolves.not.toThrow();
  });
});
