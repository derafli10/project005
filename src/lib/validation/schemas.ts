import { z } from "zod";
import type {
  TaskStatus,
  PostTag,
  DigestChannel,
  Locale,
  CookedTier,
  UserRole,
} from "@/generated/prisma";

/**
 * Zod input validation schemas.
 *
 * Design-spec schema aliases (registerSchema, loginSchema, createTaskSchema,
 * classCodeSchema, anonymousPostSchema) are exported alongside the richer
 * PascalCase variants used elsewhere in the codebase.
 *
 * References: Requirements 1.1, 1.2, 8.1, 10.3 — design.md > Input Validation
 */

// ─── AUTH SCHEMAS ───────────────────────────────────────────────────────────

export const SignupSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters long." })
    .max(64, { message: "Name must be at most 64 characters long." })
    .trim(),
  email: z
    .string()
    .email({ message: "Please enter a valid email address." })
    .trim()
    .toLowerCase(),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters long." })
    .regex(/[a-zA-Z]/, { message: "Password must contain at least one letter." })
    .regex(/[0-9]/, { message: "Password must contain at least one number." })
    .regex(/[^a-zA-Z0-9]/, {
      message: "Password must contain at least one special character.",
    })
    .trim(),
});

export type SignupInput = z.infer<typeof SignupSchema>;

export const LoginSchema = z.object({
  email: z
    .string()
    .email({ message: "Please enter a valid email address." })
    .trim()
    .toLowerCase(),
  password: z
    .string()
    .min(1, { message: "Password is required." })
    .trim(),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Design-spec alias for {@link SignupSchema}.
 * Requirements 1.1, 1.2
 */
export const registerSchema = SignupSchema;

/**
 * Design-spec alias for {@link LoginSchema}.
 * Requirements 1.1, 1.2
 */
export const loginSchema = LoginSchema;

// ─── TASK SCHEMAS ───────────────────────────────────────────────────────────

/**
 * createTaskSchema — design-spec input for creating a task.
 *
 * `classRoomId` is optional (personal tasks have no classroom).
 * `deadlineAt` is accepted as an ISO datetime string and must be in the future.
 * Requirements 1.1, 8.1
 */
export const createTaskSchema = z.object({
  title: z
    .string()
    .min(1, { message: "Title is required." })
    .max(255, { message: "Title must be at most 255 characters." })
    .trim(),
  description: z
    .string()
    .max(5000, { message: "Description must be at most 5000 characters." })
    .optional(),
  sksWeight: z
    .number()
    .int({ message: "SKS weight must be an integer." })
    .min(1, { message: "SKS weight minimum is 1." })
    .max(5, { message: "SKS weight maximum is 5." })
    .optional(),
  taskWeight: z
    .number()
    .int({ message: "Task weight must be an integer." })
    .min(0, { message: "Task weight minimum is 0." })
    .max(10000, { message: "Task weight maximum is 10000." }),
  deadlineAt: z
    .string()
    .datetime({ message: "Invalid deadline format." })
    .refine((val) => new Date(val).getTime() > Date.now(), {
      message: "Deadline must be in the future.",
    }),
  classRoomId: z.string().cuid({ message: "Invalid classroom ID." }).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Richer variant used by Server Actions (classRoomId required at the route level). */
export const TaskCreateSchema = z.object({
  classRoomId: z.string().cuid({ message: "Invalid classroom ID." }),
  title: z
    .string()
    .min(1, { message: "Title is required." })
    .max(255, { message: "Title must be at most 255 characters." })
    .trim(),
  description: z
    .string()
    .max(5000, { message: "Description must be at most 5000 characters." })
    .optional(),
  taskWeight: z
    .number()
    .int({ message: "Task weight must be an integer." })
    .min(0, { message: "Task weight minimum is 0." })
    .max(10000, { message: "Task weight maximum is 10000." }),
  deadlineAt: z
    .string()
    .datetime({ message: "Invalid deadline format." })
    .refine((val) => new Date(val).getTime() > Date.now(), {
      message: "Deadline must be in the future.",
    }),
});

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

export const TaskUpdateSchema = z.object({
  taskId: z.string().cuid({ message: "Invalid task ID." }),
  title: z
    .string()
    .min(1, { message: "Title is required." })
    .max(255, { message: "Title must be at most 255 characters." })
    .trim()
    .optional(),
  description: z
    .string()
    .max(5000, { message: "Description must be at most 5000 characters." })
    .optional(),
  taskWeight: z
    .number()
    .int({ message: "Task weight must be an integer." })
    .min(0, { message: "Task weight minimum is 0." })
    .max(10000, { message: "Task weight maximum is 10000." })
    .optional(),
  deadlineAt: z
    .string()
    .datetime({ message: "Invalid deadline format." })
    .optional(),
  status: z
    .enum(["PENDING", "IN_PROGRESS", "COMPLETED"] satisfies TaskStatus[])
    .optional(),
});

export type TaskUpdateInput = z.infer<typeof TaskUpdateSchema>;

// ─── OVERRIDE SCHEMA ────────────────────────────────────────────────────────

export const OverrideSchema = z.object({
  taskId: z.string().cuid({ message: "Invalid task ID." }),
  oldPosition: z
    .number()
    .int({ message: "Old position must be an integer." })
    .min(0),
  newPosition: z
    .number()
    .int({ message: "New position must be an integer." })
    .min(0),
  reason: z
    .string()
    .min(3, { message: "Override reason must be at least 3 characters." })
    .max(500, { message: "Override reason must be at most 500 characters." })
    .trim(),
});

export type OverrideInput = z.infer<typeof OverrideSchema>;

// ─── CLASSROOM SCHEMAS ──────────────────────────────────────────────────────

export const ClassRoomCreateSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Class name must be at least 2 characters." })
    .max(120, { message: "Class name must be at most 120 characters." })
    .trim(),
  sksWeight: z
    .number()
    .int({ message: "SKS weight must be an integer." })
    .min(1, { message: "SKS weight minimum is 1." })
    .max(5, { message: "SKS weight maximum is 5." }),
});

export type ClassRoomCreateInput = z.infer<typeof ClassRoomCreateSchema>;

export const ClassRoomJoinSchema = z.object({
  classCode: z
    .string()
    .min(6, { message: "Class code must be 6 characters." })
    .max(8, { message: "Class code must be at most 8 characters." })
    .trim()
    .toUpperCase(),
});

export type ClassRoomJoinInput = z.infer<typeof ClassRoomJoinSchema>;

/**
 * classCodeSchema — design-spec 8-character alphanumeric uppercase code.
 * Custom alphabet (no 0/O/1/I/l) is enforced at generation time; validation
 * here accepts any 8-char uppercase alphanumeric per Requirements 8.1.
 */
export const classCodeSchema = z
  .string()
  .length(8, { message: "Class code must be exactly 8 characters." })
  .regex(/^[A-Z0-9]+$/, { message: "Class code must be alphanumeric uppercase." });

// ─── ANONYMOUS POST SCHEMA ─────────────────────────────────────────────────

/**
 * anonymousPostSchema — design-spec 500-char max content + mandatory tag.
 * Requirements 10.1, 10.3, 10.10
 */
export const anonymousPostSchema = z.object({
  classRoomId: z.string().cuid({ message: "Invalid classroom ID." }),
  content: z
    .string()
    .min(1, { message: "Post content is required." })
    .max(500, { message: "Post content must be at most 500 characters." })
    .trim(),
  tag: z.enum([
    "CURHAT_TUGAS",
    "BUTUH_TEMAN_TIM",
    "TANYA_JAWABAN",
    "DISKUSI_UMUM",
  ] satisfies PostTag[]),
});

export type AnonymousPostInput = z.infer<typeof anonymousPostSchema>;

/** Backwards-compatible alias kept for any caller expecting the older max(1000) rule. */
export const AnonymousPostSchema = anonymousPostSchema;

// ─── DIGEST PREFERENCE SCHEMA ──────────────────────────────────────────────

export const DigestPreferenceSchema = z.object({
  channel: z.enum(["EMAIL", "TELEGRAM"] satisfies DigestChannel[]),
  contactId: z
    .string()
    .min(5, { message: "Contact ID must be at least 5 characters." })
    .max(64, { message: "Contact ID must be at most 64 characters." })
    .trim(),
  cronPattern: z
    .string()
    .regex(
      /^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([12]?\d|3[01])) (\*|(1[0-2]|0?[1-9])) (\*|[0-6])$/,
      { message: "Invalid cron pattern format." }
    )
    .default("0 7 * * *"),
  timezone: z
    .string()
    .min(1, { message: "Timezone is required." })
    .max(64)
    .default("Asia/Jakarta"),
  isActive: z.boolean().default(true),
});

export type DigestPreferenceInput = z.infer<typeof DigestPreferenceSchema>;

// ─── SERVER ACTION RESULT TYPES ─────────────────────────────────────────────

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export type FormState = {
  errors?: Record<string, string[]>;
  message?: string;
} | undefined;

// ─── RE-EXPORTS FOR CONVENIENCE ─────────────────────────────────────────────

export type {
  TaskStatus,
  PostTag,
  DigestChannel,
  Locale,
  CookedTier,
  UserRole,
};
