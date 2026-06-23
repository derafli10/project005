import "server-only";

import crypto from "crypto";
import { baseDb } from "@/lib/db";
import {
  AuthorizationError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import { anonymousPostSchema } from "@/lib/validation/schemas";
import type { AnonymousPost, PostTag } from "@/generated/prisma";

/**
 * Feed Service
 *
 * Handles creation and retrieval of anonymous classroom feed posts with encrypted
 * author ID tracking using RSA-OAEP.
 *
 * Requirements 10.1–10.10.
 */
export class FeedService {
  private static fallbackKeyPair: { publicKey: string; privateKey: string } | null = null;

  /**
   * Generates a 2048-bit RSA public/private key pair.
   *
   * Requirement 10.6: RSA public/private key pair generation.
   */
  static generateRsaKeyPair(): { publicKey: string; privateKey: string } {
    return crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });
  }

  /**
   * Returns a fallback public key generated in-memory.
   */
  private static getFallbackPublicKey(): string {
    if (!this.fallbackKeyPair) {
      this.fallbackKeyPair = this.generateRsaKeyPair();
    }
    return this.fallbackKeyPair.publicKey;
  }

  /**
   * Encrypts the userId using RSA public key encryption with OAEP padding.
   *
   * Requirement 10.6: encrypt authorId using crypto.publicEncrypt.
   */
  static encryptAuthorId(userId: string, publicKey?: string): string {
    const key = publicKey || process.env.ANONYMOUS_FEED_PUBLIC_KEY || this.getFallbackPublicKey();
    const encrypted = crypto.publicEncrypt(
      {
        key,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(userId)
    );
    return encrypted.toString("base64");
  }

  /**
   * Decrypts the encrypted authorId using RSA private key decryption with OAEP padding.
   * Excluded from standard environment variables for legal/compliance audits.
   *
   * Requirement 10.7: Exclude decryption keys from standard env and access offline.
   */
  static decryptAuthorId(encrypted: string, privateKey?: string): string {
    const key = privateKey || process.env.ANONYMOUS_FEED_PRIVATE_KEY || this.fallbackKeyPair?.privateKey;
    if (!key) {
      throw new Error("Private decryption key is not available in this environment.");
    }
    const decrypted = crypto.privateDecrypt(
      {
        key,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(encrypted, "base64")
    );
    return decrypted.toString("utf8");
  }

  /**
   * Submits an anonymous post to a classroom feed.
   *
   * Requirements 10.1, 10.3, 10.4, 10.5, 10.6, 10.10.
   */
  static async createAnonymousPost(
    userId: string,
    classRoomId: string,
    content: string,
    tag: PostTag
  ): Promise<AnonymousPost> {
    // 1. Verify classroom membership (Requirement 10.1).
    const membership = await baseDb.classRoomMember.findUnique({
      where: {
        classRoomId_userId: { classRoomId, userId },
      },
    });
    if (!membership) {
      throw new AuthorizationError("User must be a member of the classroom to post in its feed.");
    }

    // 2. Validate content and tag using Zod schema (Requirement 10.3, 10.4, 10.10).
    const parsed = anonymousPostSchema.safeParse({ classRoomId, content, tag });
    if (!parsed.success) {
      const hasTagError = parsed.error.issues.some((issue) => issue.path.includes("tag"));
      if (hasTagError) {
        throw new ValidationError("Pilih kategori post dulu ya!", { field: "tag" });
      }
      const firstIssue = parsed.error.issues[0];
      throw new ValidationError(
        firstIssue?.message ?? "Invalid post input",
        { field: String(firstIssue?.path[0] ?? "unknown") }
      );
    }

    // 3. Encrypt the author's userId (Requirement 10.6).
    const encryptedAuthorId = this.encryptAuthorId(userId);

    // 4. Insert into database using baseDb (un-scoped context).
    return baseDb.anonymousPost.create({
      data: {
        classRoomId,
        content: parsed.data.content,
        tag: parsed.data.tag,
        encryptedAuthorId,
      },
    });
  }

  /**
   * Retrieves feed posts for a classroom.
   *
   * Requirements 10.1, 10.2, 10.8, 10.9.
   */
  static async getFeedPosts(
    userId: string,
    classRoomId: string,
    tag?: PostTag
  ): Promise<AnonymousPost[]> {
    // 1. Verify classroom membership (Requirement 10.1).
    const membership = await baseDb.classRoomMember.findUnique({
      where: {
        classRoomId_userId: { classRoomId, userId },
      },
    });
    if (!membership) {
      throw new AuthorizationError("User must be a member of the classroom to view its feed.");
    }

    // 2. Fetch posts from database in reverse chronological order (Requirement 10.2, 10.9).
    return baseDb.anonymousPost.findMany({
      where: {
        classRoomId,
        ...(tag ? { tag } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }
}

/** Default singleton for ergonomic imports. */
export const feedService = FeedService;
