import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import bcrypt from "bcryptjs";

import { AuthService } from "@/lib/services/auth.service";
import { ConflictError, AuthenticationError } from "@/lib/errors/domain-errors";
import { buildInMemoryClient, resetInMemoryDb } from "./helpers/in-memory-db";

/**
 * Mock the DB module so that both `db` and `baseDb` resolve to the
 * in-memory client. `withUserContext` is a pass-through since the auth service
 * does not rely on AsyncLocalStorage scoping (it passes userId explicitly).
 */
const mockClient = buildInMemoryClient();

vi.mock("@/lib/db", () => ({
  db: mockClient,
  baseDb: mockClient,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

/**
 * Property-based tests for the Authentication Service.
 *
 * @tags Feature: project005-task-management-dss, Property 1, Property 2, Property 3, Property 4
 *
 * Reference: design.md > Correctness Properties 1–4, Requirements 1.1–1.8.
 */

beforeEach(() => {
  resetInMemoryDb();
});

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** A valid email (RFC-friendly subset). */
const validEmailArb = fc
  .stringOf(
    fc.array(
      fc.constantFrom(
        // Alphanumeric + dots, dashes, pluses (simplified)
        ..."abcdefghijklmnopqrstuvwxyz0123456789"
      ),
      { minLength: 1, maxLength: 12 }
    ).chain((local) =>
      fc.tuple(
        fc.constant(local.join("")),
        fc.constantFrom(
          "example.com",
          "test.org",
          "mail.net",
          "university.edu"
        )
      )
    ),
    { maxLength: 1 }
  )
  .map(([parts]) => {
    const [local, domain] = parts as [string[], string];
    return `${local.join("")}@${domain}`;
  });

/** A valid password ≥ 8 chars with at least one letter, one number, one special. */
const validPasswordArb = fc
  .stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%"
    ),
    { minLength: 8, maxLength: 64 }
  )
  .filter((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p));

/** A valid name ≥ 2 chars. */
const validNameArb = fc.stringOf(
  fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ "
  ),
  { minLength: 2, maxLength: 64 }
).filter((n) => n.trim().length >= 2);

// ─── Property 1: Registration with Valid Credentials Creates Account ───────

describe("Property 1: Registration with Valid Credentials Creates Account", () => {
  it("returns a user (without passwordHash) for any valid email + password + name", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, validNameArb,
        async (email, password, name) => {
          const user = await AuthService.register(email, password, name);

          // Must return a user object.
          expect(user).toBeDefined();
          expect(user.email).toBe(email.toLowerCase());
          expect(user.name).toBe(name.trim());
          expect((user as Record<string, unknown>).passwordHash).toBeUndefined();
          expect(user.id).toBeDefined();

          // The password must have been hashed (not stored in plaintext).
          // We verify by looking it up from the store.
          const { getInMemoryStore } = await import("./helpers/store");
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
  it("throws ConflictError when the email already exists", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, validNameArb,
        async (email, password, name) => {
          // First registration should succeed.
          await AuthService.register(email, password, name);

          // Second registration with the same email must throw.
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
  it("returns a sessionToken after registering and logging in", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, validNameArb,
        async (email, password, name) => {
          // Register.
          const user = await AuthService.register(email, password, name);

          // Login with the same credentials.
          const result = await AuthService.login(email, password);

          expect(result.sessionToken).toBeTruthy();
          expect(typeof result.sessionToken).toBe("string");
          expect(result.user.id).toBe(user.id);

          // The session should exist in the store.
          const { getInMemoryStore } = await import("./helpers/store");
          const store = getInMemoryStore();
          const session = store.sessions.get(result.sessionToken);
          expect(session).toBeDefined();
          if (session) {
            expect(session.userId).toBe(user.id);
            // Expires should be ~30 days in the future.
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
  it("throws AuthenticationError for wrong password", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, validNameArb, validPasswordArb,
        async (email, correctPassword, name, wrongPassword) => {
          // Skip when the passwords happen to be the same.
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

  it("throws AuthenticationError for a non-existent email", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb,
        async (email, password) => {
          // Register a *different* user so the store is non-empty (tests a
          // realistic scenario where the DB is live but the email doesn't
          // match).
          await AuthService.register("other@example.com", "ValidP@ss1!", "Other");

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
    const { sessionToken, user } = await AuthService.login(email, password);

    // Force-expire the session in the store.
    const { getInMemoryStore } = await import("./helpers/store");
    const store = getInMemoryStore();
    const session = store.sessions.get(sessionToken);
    if (session) {
      session.expires = new Date(Date.now() - 1000); // 1 second ago
    }

    const result = await AuthService.validateSession(sessionToken);
    expect(result).toBeNull();

    // Session should have been deleted.
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
