"use server";

import { auth } from "@/auth";
import { FeedService } from "@/lib/services/feed.service";
import {
  AuthorizationError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import {
  anonymousPostSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
import type { PostTag } from "@/generated/prisma";
import { revalidatePath } from "next/cache";

type ZodIssueLike = { path: PropertyKey[]; message: string };

function collectFieldErrors(
  issues: ZodIssueLike[]
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/**
 * Server Action to create an anonymous feed post.
 * Requirements 10.1, 10.3, 10.4, 10.5, 10.6, 10.10
 */
export async function createFeedPostAction(
  classRoomId: string,
  content: string,
  tag: PostTag
): Promise<ActionResult<{ id: string }>> {
  // Authentication check
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }
  const userId = session.user.id;

  // Client-side schema validation
  const parsed = anonymousPostSchema.safeParse({ classRoomId, content, tag });
  if (!parsed.success) {
    const hasTagError = parsed.error.issues.some((issue) =>
      issue.path.includes("tag")
    );
    if (hasTagError) {
      return {
        success: false,
        error: "Pilih kategori post dulu ya!",
        fieldErrors: { tag: ["Pilih kategori post dulu ya!"] },
      };
    }
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Validation failed",
      fieldErrors: collectFieldErrors(
        parsed.error.issues as ZodIssueLike[]
      ),
    };
  }

  try {
    const post = await FeedService.createAnonymousPost(
      userId,
      parsed.data.classRoomId,
      parsed.data.content,
      parsed.data.tag
    );

    revalidatePath(`/classrooms/${classRoomId}/feed`);

    return {
      success: true,
      data: { id: post.id },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        success: false,
        error: error.message,
        fieldErrors: error.details?.field
          ? { [error.details.field as string]: [error.message] }
          : undefined,
      };
    }
    if (error instanceof AuthorizationError) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: "An unexpected error occurred.",
    };
  }
}
