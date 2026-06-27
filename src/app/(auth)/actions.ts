"use server";

/**
 * Authentication Server Actions.
 *
 * Canonical, reusable Server Actions for the `(auth)` route group. Each action
 * delegates to {@link AuthService} (registration, login, logout on the Prisma
 * `Session` table) and returns the standard {@link ActionResult} discriminated
 * union so client components can branch on `success` for optimistic UI, toasts,
 * redirects, etc. (design.md > Server Action Error Responses).
 *
 * Session handling:
 *  - `loginAction`    — authenticates, then persists the opaque session token
 *                       returned by `AuthService.login` in an HTTP-only cookie
 *                       (Requirement 1.5: Secure + SameSite=Strict).
 *  - `logoutAction`   — destroys the `Session` row and clears the cookie
 *                       (Requirement 1.8).
 *
 * NOTE ON AUTH MECHANISMS
 *  This project exposes two complementary session surfaces: Auth.js v5 (JWT
 *  cookie set via `signIn`, consumed by `auth()` / middleware) and the
 *  `AuthService` opaque-token `Session` table wired here. These actions own the
 *  latter; bridging the opaque token into `auth()` is handled separately. The
 *  actions are intentionally side-effect-pure toward the client (no implicit
 *  `redirect`) — callers decide navigation based on the returned `ActionResult`.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8
 */

import { cookies } from "next/headers";

import { AuthService, type SafeUser } from "@/lib/services/auth.service";
import {
  AuthenticationError,
  ConflictError,
  DomainError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import {
  LoginSchema,
  SignupSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

// ─── SESSION COOKIE CONFIG ──────────────────────────────────────────────────

/**
 * Cookie name holding the opaque `AuthService` session token.
 *
 * Deliberately distinct from Auth.js' `authjs.session-token` so the two session
 * surfaces do not collide (see file-level note).
 */
export const SESSION_COOKIE_NAME = "project005.session";

/** Session TTL in seconds — mirrors `AuthService` 30-day window (Requirement 1.9). */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Cookie options enforcing Requirement 1.5:
 * HTTP-only, Secure (production), SameSite=Strict, scoped to root path.
 */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;

// ─── INPUT TYPES ────────────────────────────────────────────────────────────

/** Input contract for {@link registerAction}. */
export interface RegisterActionInput {
  name: string;
  email: string;
  password: string;
}

/** Input contract for {@link loginAction}. */
export interface LoginActionInput {
  email: string;
  password: string;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

/** Minimal structural view of a Zod issue (version-agnostic). */
type ZodIssueLike = { path: PropertyKey[]; message: string };

/**
 * Fold Zod issues into a `{ field: messages }` record for inline display.
 * Mirrors the helper used by the `(auth)` page Server Components.
 */
function collectFieldErrors(
  issues: ZodIssueLike[],
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    // `noUncheckedIndexedAccess`: path elements may be undefined.
    if (typeof key !== "string") continue;
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

// ─── ACTIONS ────────────────────────────────────────────────────────────────

/**
 * Register a new account (Requirement 1.1).
 *
 * Validates with {@link SignupSchema}, then delegates to
 * `AuthService.register`. Duplicate emails surface as a `ConflictError`
 * (Requirement 1.2); service-level input checks surface as `ValidationError`.
 *
 * @returns `ActionResult<SafeUser>` — the created user (without passwordHash)
 *          on success, or a localized error / field-error map on failure.
 */
export async function registerAction(
  input: RegisterActionInput,
): Promise<ActionResult<SafeUser>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const parsed = SignupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: t("error.validationFailed"),
      fieldErrors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]),
    };
  }
  const { name, email, password } = parsed.data;

  try {
    // Service signature is (email, password, name) — pass in that order.
    const user = await AuthService.register(email, password, name);
    return { success: true, data: user };
  } catch (err) {
    if (err instanceof ConflictError) {
      // Requirement 1.2 — duplicate email.
      const message = t("auth.register.emailExists");
      return {
        success: false,
        error: message,
        fieldErrors: { email: [message] },
      };
    }
    if (err instanceof ValidationError) {
      const field =
        (err.details?.field as string | undefined) ?? "form";
      return {
        success: false,
        error: err.message,
        fieldErrors: { [field]: [err.message] },
      };
    }
    if (err instanceof DomainError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}

/**
 * Authenticate and establish a session (Requirements 1.3, 1.4, 1.5).
 *
 * Validates with {@link LoginSchema}, delegates to `AuthService.login` (which
 * creates a `Session` row and returns an opaque token), then persists that
 * token in an HTTP-only cookie. Invalid credentials yield an
 * `AuthenticationError` mapped to a unified message (Requirement 1.4 — never
 * reveals whether the email exists).
 *
 * @returns `ActionResult<SafeUser>` — the authenticated user on success.
 */
export async function loginAction(
  input: LoginActionInput,
): Promise<ActionResult<SafeUser>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const parsed = LoginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: t("error.validationFailed"),
      fieldErrors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]),
    };
  }
  const { email, password } = parsed.data;

  try {
    const { user, sessionToken } = await AuthService.login(email, password);

    // Requirement 1.5 — store the session token in a hardened cookie.
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);

    return { success: true, data: user };
  } catch (err) {
    if (err instanceof AuthenticationError) {
      return { success: false, error: t("auth.login.invalidCredentials") };
    }
    if (err instanceof DomainError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: t("error.generic") };
  }
}

/**
 * Log the current user out (Requirement 1.8).
 *
 * Reads the session token from the cookie, destroys the backing `Session` row
 * via `AuthService.logout`, and clears the cookie. Idempotent — succeeds even
 * when no session was present.
 *
 * @returns `ActionResult<void>` — the client should navigate to `/login`.
 */
export async function logoutAction(): Promise<ActionResult<void>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (token) {
      await AuthService.logout(token);
    }

    cookieStore.delete(SESSION_COOKIE_NAME);
    return { success: true, data: undefined };
  } catch {
    // Defensive: never leak internal failures from logout; treat as generic.
    return { success: false, error: t("error.generic") };
  }
}
