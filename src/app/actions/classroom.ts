"use server";

import { auth } from "@/auth";
import { ClassRoomService } from "@/lib/services/classroom.service";
import {
  ValidationError,
  ConflictError,
  NotFoundError,
} from "@/lib/errors/domain-errors";
import {
  ClassRoomCreateSchema,
  ClassRoomJoinSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";
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
 * Server Action to create a classroom.
 * Calls ClassRoomService.createClassRoom and returns the created classroom data.
 */
export async function createClassRoomAction(
  name: string,
  sksWeight: number
): Promise<ActionResult<{ id: string; className: string; classCode: string }>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authentication check
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }
  const userId = session.user.id;

  // Validate inputs
  const parsed = ClassRoomCreateSchema.safeParse({ name, sksWeight });
  if (!parsed.success) {
    return {
      success: false,
      error: t("error.validationFailed") || "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]),
    };
  }

  try {
    const classRoom = await ClassRoomService.createClassRoom(
      parsed.data.name,
      userId,
      parsed.data.sksWeight
    );

    revalidatePath("/classrooms");
    revalidatePath("/dashboard");

    return {
      success: true,
      data: {
        id: classRoom.id,
        className: classRoom.className,
        classCode: classRoom.classCode,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      const field = error.details?.field;
      return {
        success: false,
        error: error.message,
        fieldErrors: typeof field === "string" ? { [field]: [error.message] } : undefined,
      };
    }
    if (error instanceof ConflictError) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: t("error.unknown") || "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action to join a classroom.
 */
export async function joinClassRoomAction(
  classCode: string
): Promise<ActionResult<{ id: string; className: string }>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authentication check
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }
  const userId = session.user.id;

  // Validate class code
  const parsed = ClassRoomJoinSchema.safeParse({ classCode });
  if (!parsed.success) {
    return {
      success: false,
      error: t("error.validationFailed") || "Validation failed",
      fieldErrors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]),
    };
  }

  try {
    const result = await ClassRoomService.joinClassRoom(
      parsed.data.classCode,
      userId
    );

    revalidatePath("/classrooms");
    revalidatePath("/dashboard");

    return {
      success: true,
      data: {
        id: result.classRoom.id,
        className: result.classRoom.className,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      const field = error.details?.field;
      return {
        success: false,
        error: error.message,
        fieldErrors: typeof field === "string" ? { [field]: [error.message] } : undefined,
      };
    }
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: t("error.unknown") || "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action to leave a classroom.
 */
export async function leaveClassRoomAction(
  classRoomId: string
): Promise<ActionResult<void>> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Authentication check
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: t("error.unauthorized") };
  }
  const userId = session.user.id;

  try {
    await ClassRoomService.leaveClassRoom(classRoomId, userId);

    revalidatePath("/classrooms");
    revalidatePath("/dashboard");

    return { success: true, data: undefined };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { success: false, error: error.message };
    }
    return {
      success: false,
      error: t("error.unknown") || "An unexpected error occurred.",
    };
  }
}
