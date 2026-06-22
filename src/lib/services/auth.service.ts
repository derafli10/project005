import "server-only";

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  AuthenticationError,
  ConflictError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import type { User, Session } from "@/generated/prisma";

/**
 * Authentication Service
 *
 * Implements registration, login, session validation and logout on top of the
 * Prisma `User`/`Session` models. Passwords are hashed with bcrypt using 10
 * rounds (Requirement 1.1). Session tokens are opaque random strings stored in
 * the `Session` table; the HTTP-only cookie wiring lives in `src/auth.ts`
 * (Auth.js v5).
 *
 * Reference: design.md > Authentication Service, Requirements 1.1–1.10.
 */

/** bcrypt cost factor — Requirement 1.1 (encrypted with bcrypt). */
const BCRYPT_ROUNDS = 10;

/** Session TTL — Requirement 1.9 (30 days of inactivity). */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Byte length of the generated session token (256 bits of entropy). */
const SESSION_TOKEN_BYTES = 32;

/** Public projection of a User record (never leaks passwordHash). */
export type SafeUser = Pick<
  User,
  "id" | "email" | "name" | "role" | "locale" | "createdAt" | "updatedAt"
>;

function toSafeUser(user: User): SafeUser {
  const { passwordHash: _ignored, ...safe } = user;
  return safe;
}

/**
 * Generate a cryptographically-strong opaque session token.
 * Uses Node's `crypto.randomBytes` (URL-safe base64).
 */
function generateSessionToken(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("node:crypto") as typeof import("node:crypto");
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export class AuthService {
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Hash a plain-text password using bcrypt (10 rounds).
   * Requirement 1.1.
   */
  static async hashPassword(plainPassword: string): Promise<string> {
    if (!plainPassword || plainPassword.length < 8) {
      throw new ValidationError("Password must be at least 8 characters", {
        field: "password",
      });
    }
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    return bcrypt.hash(plainPassword, salt);
  }

  /**
   * Compare a plain-text password against a stored bcrypt hash.
   * Constant-time comparison is provided by bcrypt internally.
   */
  static async verifyPassword(
    plainPassword: string,
    hashedPassword: string
  ): Promise<boolean> {
    if (!plainPassword || !hashedPassword) return false;
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Register a new user.
   *
   * @throws {ConflictError}     if the email is already registered (Requirement 1.2)
   * @throws {ValidationError}   if the email/password/name are invalid
   */
  static async register(
    email: string,
    password: string,
    name: string
  ): Promise<SafeUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new ValidationError("A valid email is required", { field: "email" });
    }
    if (!trimmedName || trimmedName.length < 2) {
      throw new ValidationError("Name must be at least 2 characters", {
        field: "name",
      });
    }
    if (!password || password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters", {
        field: "password",
      });
    }

    // Requirement 1.2 — reject duplicate emails
    const existing = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("Email sudah terdaftar", { field: "email" });
    }

    const passwordHash = await this.hashPassword(password);

    // Requirement 1.10 — createdAt/updatedAt maintained by Prisma defaults.
    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        name: trimmedName,
        passwordHash,
      },
    });

    return toSafeUser(user);
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Authenticate a user and create a new session record.
   *
   * @returns The user (without passwordHash) and a fresh opaque session token.
   * @throws {AuthenticationError} if credentials are invalid (Requirement 1.4)
   */
  static async login(
    email: string,
    password: string
  ): Promise<{ user: SafeUser; sessionToken: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Requirement 1.4 — invalid email OR password → identical auth error.
    if (!user || !user.passwordHash) {
      throw new AuthenticationError("Email atau password salah");
    }

    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new AuthenticationError("Email atau password salah");
    }

    const sessionToken = generateSessionToken();
    const expires = new Date(Date.now() + SESSION_TTL_MS);

    // Requirement 1.3 — create a Session record tied to the user.
    await db.session.create({
      data: {
        sessionToken,
        userId: user.id,
        expires,
      },
    });

    return { user: toSafeUser(user), sessionToken };
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Validate a session token and return the associated user.
   *
   * @returns The user if the session exists and has not expired, else `null`.
   * Requirement 1.6 — every protected resource must verify the session first.
   * Requirement 1.9 — expired sessions are destroyed.
   */
  static async validateSession(sessionToken: string): Promise<SafeUser | null> {
    if (!sessionToken) return null;

    const session = await db.session.findUnique({
      where: { sessionToken },
      include: { user: true },
    });

    if (!session) return null;

    // Requirement 1.9 — purge expired sessions, force re-login.
    if (session.expires.getTime() < Date.now()) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {
        /* ignore race-condition deletion failures */
      });
      return null;
    }

    return toSafeUser(session.user);
  }

  /** Look up a session record directly (useful for tests / introspection). */
  static async getSession(sessionToken: string): Promise<Session | null> {
    if (!sessionToken) return null;
    return db.session.findUnique({ where: { sessionToken } });
  }

  // ───────────────────────────────────────────────────────────────────────
  /**
   * Destroy the session — removes the DB row so the token can no longer be
   * used (Requirement 1.8). Cookie clearing is the caller's responsibility.
   */
  static async logout(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    await db.session
      .delete({ where: { sessionToken } })
      .catch(() => {
        /* idempotent — already logged out */
      });
  }
}

/** Default singleton for ergonomic imports. */
export const authService = AuthService;
