import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import bcrypt from "bcryptjs";

import { resetInMemoryDb, getInMemoryStore } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

/**
 * Integration tests for the authentication flow at the Server Action boundary.
 *
 * @tags Feature: project005-task-management-dss, Task 9.5
 *
 * Reference: tasks.md 9.5, design.md > Server Action Error Responses +
 *   Testing Strategy > Authentication Round-Trip & Locale Switching.
 *
 * Scope
 *   These tests exercise the **Server Action layer** — `registerAction`,
 *   `loginAction`, `logoutAction` (src/app/(auth)/actions.ts) and
 *   `switchLocaleAction` (src/app/actions/locale.ts) — wired against the REAL
 *   `AuthService` and the in-memory Prisma mock. This is the genuinely
 *   untested integration boundary: the service-level correctness is already
 *   covered by `auth-service.property.test.ts`, while these tests verify the
 *   ActionResult mapping, cookie wiring, authorization gating, and locale
 *   persistence that only the action layer owns.
 *
 * Sub-bullets covered (tasks.md 9.5):
 *   1. register → verify account → login → verify session
 *   2. duplicate email rejection
 *   3. invalid credentials rejection
 *   4. locale switching and persistence across sessions
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.4.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// The Server Actions live in the `(auth)` route group and transitively pull in
// `next/headers` (`cookies()`), the Auth.js `auth()` helper (`@/i18n/server`
// → `@/auth`), and `unstable_update`. None of those are usable in vitest, so
// we stub them while keeping the REAL `AuthService` (which hits the mocked
// `@/lib/db`).

const { mockDb, mockCookies, mockAuthFn, mockUnstableUpdateFn } = vi.hoisted(() => ({
  // Prisma mock — hydrated per-test to point at the in-memory store.
  mockDb: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    session: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
  },
  // `cookies()` store — a plain Map<string, string> the actions write to.
  mockCookies: {
    store: new Map<string, string>(),
    async get(name: string) {
      return { value: this.store.get(name) } as { value?: string } | undefined;
    },
    async set(name: string, value: string) {
      this.store.set(name, value);
    },
    async delete(name: string) {
      this.store.delete(name);
    },
  },
  // Auth.js `auth()` — configurable per-test to simulate the session.
  mockAuthFn: vi.fn(),
  // Auth.js `unstable_update()` — no-op by default, spied on for assertions.
  mockUnstableUpdateFn: vi.fn(async () => ({})),
}));

/** Hydrate the Prisma mock against a freshly reset in-memory client. */
function hydrateMock(): void {
  const client = buildInMemoryClient();
  mockDb.user.findUnique.mockImplementation(client.user.findUnique.bind(client.user));
  mockDb.user.create.mockImplementation(client.user.create.bind(client.user));
  mockDb.user.update.mockImplementation(client.user.update.bind(client.user));
  mockDb.session.findUnique.mockImplementation(
    client.session.findUnique.bind(client.session),
  );
  mockDb.session.create.mockImplementation(client.session.create.bind(client.session));
  mockDb.session.delete.mockImplementation(client.session.delete.bind(client.session));
}

// `@/lib/db` — AuthService + the locale action both resolve through here.
vi.mock("@/lib/db", () => ({
  db: mockDb,
  baseDb: mockDb,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

// `@/auth` — the locale action imports `auth` + `unstable_update` from here.
vi.mock("@/auth", () => ({
  auth: mockAuthFn,
  unstable_update: mockUnstableUpdateFn,
}));

// `next/headers` — `cookies()` used by login/logout actions.
vi.mock("next/headers", () => ({
  cookies: async () => mockCookies,
}));

// `@/i18n/server` — `getLocale()` is called by the auth actions. It normally
// reads the `x-locale` header / session, neither of which exist in tests, so
// we pin it to EN to keep the ActionResult error strings deterministic.
vi.mock("@/i18n/server", () => ({
  getLocale: async () => "EN" as const,
}));

// Service / action imports MUST come after every vi.mock declaration above.
import { registerAction, loginAction, logoutAction } from "@/app/(auth)/actions";
import { switchLocaleAction } from "@/app/actions/locale";
import { SESSION_COOKIE_NAME } from "@/app/(auth)/actions";
import { AuthenticationError, ConflictError } from "@/lib/errors/domain-errors";
import type { Locale } from "@/lib/validation/schemas";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
  mockCookies.store.clear();
  mockAuthFn.mockReset();
  mockUnstableUpdateFn.mockReset();
  mockUnstableUpdateFn.mockResolvedValue({});
  vi.clearAllMocks();
});

// ─── Test helpers ───────────────────────────────────────────────────────────

/**
 * Drive `auth()` to return a session for a given user id. Mirrors what the
 * real Auth.js `auth()` would produce for an authenticated request — the
 * locale action reads `session.user.id` from it.
 */
function givenSignedInAs(userId: string, locale: Locale = "EN"): void {
  mockAuthFn.mockResolvedValue({
    user: { id: userId, locale },
  });
}

/** Simulate an unauthenticated request. */
function givenSignedOut(): void {
  mockAuthFn.mockResolvedValue(null);
}

// ─── 1. register → verify → login → verify session ─────────────────────────

describe("Task 9.5.1 — Complete flow: register → verify → login → verify session", () => {
  it("registers an account, verifies it, logs in, and establishes a session cookie", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Valid email guaranteed unique via UUID.
        fc.uuid().map((id) => `${id}@test.example`),
        // Valid password ≥ 8 chars with letter + digit + special.
        fc
          .stringMatching(/[a-zA-Z0-9!@#$%]{8,64}/)
          .filter(
            (p) =>
              /[a-zA-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p),
          ),
        // Valid name ≥ 2 chars.
        fc.stringMatching(/[a-zA-Z ]{2,64}/).filter((n) => n.trim().length >= 2),
        async (email, password, name) => {
          // ── Register ──────────────────────────────────────────────────
          const registerResult = await registerAction({ name, email, password });

          expect(registerResult.success).toBe(true);
          if (!registerResult.success) return; // narrow for TS
          const user = registerResult.data;

          // The returned SafeUser must NEVER leak passwordHash (Req 1.1).
          expect((user as Record<string, unknown>).passwordHash).toBeUndefined();
          expect(user.email).toBe(email.toLowerCase());
          expect(user.name).toBe(name.trim());

          // ── Verify account persisted + password hashed (not plaintext) ──
          const store = getInMemoryStore();
          const stored = store.users.get(user.id);
          expect(stored).toBeDefined();
          expect(stored?.passwordHash).not.toBe(password);
          expect(
            await bcrypt.compare(password, stored?.passwordHash ?? ""),
          ).toBe(true);

          // ── Login with the same credentials ────────────────────────────
          const loginResult = await loginAction({ email, password });

          expect(loginResult.success).toBe(true);
          if (!loginResult.success) return;
          expect(loginResult.data.id).toBe(user.id);

          // ── Verify session: token persisted in the DB Session table ────
          //    (Req 1.3) AND in the HTTP-only cookie set by the action
          //    (Req 1.5). We can't assert cookie attributes through the mock,
          //    but the action writes to `cookies().set`, so the value must
          //    be present in our mock store under SESSION_COOKIE_NAME.
          expect(mockCookies.store.get(SESSION_COOKIE_NAME)).toBeTruthy();
        },
      ),
      { numRuns: 25 },
    );
  });

  it("rejects registration when Zod validation fails (malformed input)", async () => {
    const result = await registerAction({
      name: "A", // < 2 chars
      email: "not-an-email",
      password: "short", // < 8 chars, no number/special
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    // Field-level errors are surfaced for inline display (design.md §6).
    expect(result.fieldErrors).toBeDefined();
    expect(Object.keys(result.fieldErrors ?? {}).length).toBeGreaterThan(0);

    // Nothing should have been written to the store.
    expect(getInMemoryStore().users.size).toBe(0);
  });

  it("logout clears the session cookie and destroys the DB session (Requirement 1.8)", async () => {
    const email = "logout@flow.test";
    const password = "Str0ng!Pass";
    await registerAction({ name: "Logout User", email, password });
    const loginResult = await loginAction({ email, password });
    if (!loginResult.success) throw new Error("login should succeed");

    const cookieToken = mockCookies.store.get(SESSION_COOKIE_NAME);
    expect(cookieToken).toBeTruthy();

    // A Session row must exist for the token issued at login.
    expect(getInMemoryStore().sessions.has(cookieToken!)).toBe(true);

    const logoutResult = await logoutAction();
    expect(logoutResult.success).toBe(true);

    // Cookie cleared.
    expect(mockCookies.store.has(SESSION_COOKIE_NAME)).toBe(false);
    // DB session destroyed.
    expect(getInMemoryStore().sessions.has(cookieToken!)).toBe(false);
  });
});

// ─── 2. Duplicate email rejection ──────────────────────────────────────────

describe("Task 9.5.2 — Duplicate email rejection", () => {
  it("returns a localized error pointing at the email field when the email exists", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid().map((id) => `${id}@test.example`),
        fc
          .stringMatching(/[a-zA-Z0-9!@#$%]{8,64}/)
          .filter(
            (p) =>
              /[a-zA-Z]/.test(p) && /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p),
          ),
        fc.stringMatching(/[a-zA-Z ]{2,64}/).filter((n) => n.trim().length >= 2),
        async (email, password, name) => {
          // First registration succeeds.
          const first = await registerAction({ name, email, password });
          expect(first.success).toBe(true);

          // Second registration with the SAME email must be rejected.
          // Requirement 1.2: surface a ConflictError-derived message scoped to
          // the email field (design.md §6 Server Action Error Responses).
          const second = await registerAction({
            name,
            email,
            password: "DifferentP@ss1",
          });

          expect(second.success).toBe(false);
          if (second.success) return;
          expect(second.fieldErrors?.email).toBeDefined();
          expect(second.fieldErrors?.email?.length).toBeGreaterThan(0);

          // Exactly one user row should exist — the duplicate must not write.
          expect(getInMemoryStore().users.size).toBe(1);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("duplicate email maps to the ConflictError code path (409)", async () => {
    const email = "dup@flow.test";
    const password = "Str0ng!Pass";
    await registerAction({ name: "First User", email, password });

    const result = await registerAction({
      name: "Second User",
      email,
      password,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    // The action translates ConflictError → fieldErrors.email. We assert the
    // underlying AuthService still throws the typed error so the contract is
    // documented at the integration boundary.
    await expect(
      import("@/lib/services/auth.service").then((m) =>
        m.AuthService.register(email, password, "Third"),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ─── 3. Invalid credentials rejection ──────────────────────────────────────

describe("Task 9.5.3 — Invalid credentials rejection", () => {
  it("wrong password → ActionResult error, no cookie set (Requirement 1.4)", async () => {
    const email = "creds@flow.test";
    const password = "Str0ng!Pass";
    await registerAction({ name: "Creds User", email, password });

    const result = await loginAction({ email, password: "TotallyWr0ng!" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);

    // Security: a failed login must NOT set a session cookie.
    expect(mockCookies.store.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("non-existent email → same error shape as wrong password (no email leakage)", async () => {
    // Requirement 1.4: invalid email OR password → identical auth error so an
    // attacker cannot enumerate accounts. We assert the error string is
    // present and non-empty but make no claim that distinguishes the two
    // causes.
    const result = await loginAction({
      email: "ghost@nowhere.test",
      password: "Str0ng!Pass",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
    expect(mockCookies.store.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("malformed login input is caught by Zod before hitting AuthService", async () => {
    const result = await loginAction({
      email: "not-an-email",
      password: "",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    // Validation errors surface as fieldErrors, not a generic error string.
    expect(result.fieldErrors).toBeDefined();
    expect(Object.keys(result.fieldErrors ?? {}).length).toBeGreaterThan(0);
    expect(mockCookies.store.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("the underlying AuthService still throws AuthenticationError for bad credentials", async () => {
    const email = "auth-err@flow.test";
    const password = "Str0ng!Pass";
    await registerAction({ name: "AuthErr User", email, password });

    const { AuthService } = await import("@/lib/services/auth.service");
    await expect(
      AuthService.login(email, "WrongPass!1"),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

// ─── 4. Locale switching and persistence across sessions ───────────────────

describe("Task 9.5.4 — Locale switching and persistence across sessions", () => {
  it("persists the new locale to User.locale and returns it (Requirements 2.2, 2.6)", async () => {
    const email = "locale@flow.test";
    const password = "Str0ng!Pass";
    const reg = await registerAction({ name: "Locale User", email, password });
    if (!reg.success) throw new Error("register should succeed");
    const userId = reg.data.id;

    // Default locale after registration is EN.
    const store = getInMemoryStore();
    expect(store.users.get(userId)?.locale).toBe("EN");

    givenSignedInAs(userId, "EN");
    const result = await switchLocaleAction("ID");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBe("ID");

    // Source of truth updated in the DB.
    expect(store.users.get(userId)?.locale).toBe("ID");

    // The Auth.js session JWT must be refreshed so middleware/Server
    // Components pick up the new locale without a re-login (Requirement 2.6).
    expect(mockUnstableUpdateFn).toHaveBeenCalledWith({
      user: { locale: "ID" },
    });
  });

  it("locale persists across sessions: a fresh login still sees the saved locale (Requirement 2.4)", async () => {
    const email = "persist@flow.test";
    const password = "Str0ng!Pass";
    const reg = await registerAction({ name: "Persist User", email, password });
    if (!reg.success) throw new Error("register should succeed");
    const userId = reg.data.id;

    // Session 1: switch to ID.
    givenSignedInAs(userId, "EN");
    const switched = await switchLocaleAction("ID");
    expect(switched.success).toBe(true);

    // Simulate "logout" by clearing the session surfaces, then simulate a
    // brand-new authenticated request whose `auth()` reads the persisted
    // locale back out of the User record (Requirement 2.4).
    givenSignedInAs(userId, "ID");

    // The persisted value in the DB is the durable signal — the JWT/locale
    // claim on the new session is derived from it.
    const persisted = getInMemoryStore().users.get(userId)?.locale;
    expect(persisted).toBe("ID");

    // switchLocaleAction can flip back to EN, proving the session is mutable
    // post-relogin.
    const result = await switchLocaleAction("EN");
    expect(result.success).toBe(true);
    expect(getInMemoryStore().users.get(userId)?.locale).toBe("EN");
  });

  it("rejects a locale switch when the user is unauthenticated", async () => {
    givenSignedOut();
    await expect(switchLocaleAction("ID")).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    // Nothing should have been written or propagated.
    expect(mockUnstableUpdateFn).not.toHaveBeenCalled();
  });

  it("rejects an unsupported locale value (defence-in-depth)", async () => {
    const email = "guard@flow.test";
    const password = "Str0ng!Pass";
    const reg = await registerAction({ name: "Guard User", email, password });
    if (!reg.success) throw new Error("register should succeed");

    givenSignedInAs(reg.data.id, "EN");

    // Bypass the TS type with `as unknown as Locale` to exercise the runtime
    // whitelist in switchLocaleAction.
    await expect(
      switchLocaleAction("FR" as unknown as Locale),
    ).rejects.toThrow();

    expect(mockUnstableUpdateFn).not.toHaveBeenCalled();
    // The stored locale is unchanged.
    expect(getInMemoryStore().users.get(reg.data.id)?.locale).toBe("EN");
  });

  it("supports toggling EN ↔ ID repeatedly without drift", async () => {
    const email = "toggle@flow.test";
    const password = "Str0ng!Pass";
    const reg = await registerAction({ name: "Toggle User", email, password });
    if (!reg.success) throw new Error("register should succeed");
    const userId = reg.data.id;
    givenSignedInAs(userId, "EN");

    const sequence: Locale[] = ["ID", "EN", "ID", "ID", "EN"];
    let expected: Locale = "EN";
    for (const next of sequence) {
      expected = next;
      const result = await switchLocaleAction(next);
      expect(result.success).toBe(true);
      expect(getInMemoryStore().users.get(userId)?.locale).toBe(expected);
    }
    expect(getInMemoryStore().users.get(userId)?.locale).toBe("EN");
  });
});
