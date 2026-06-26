"use client";

import { useActionState } from "react";
import Link from "next/link";

import type { FormState } from "@/lib/validation/schemas";

/**
 * Login form — Client Component.
 *
 * Wires the Server Action (passed in from the Server Component page so it can
 * stay inline there) into `useActionState`, renders inline Zod validation
 * errors as they come back, and submits the form via a plain `<form action>`.
 *
 * All visible text is pre-resolved server-side and passed in via `labels`, so
 * the client never needs to know the active locale (Requirement 2.5).
 *
 * Requirements: 1.1, 1.3, 1.4
 */
export interface LoginFormLabels {
  email: string;
  emailPlaceholder: string;
  password: string;
  passwordPlaceholder: string;
  submit: string;
  noAccount: string;
  registerLink: string;
  registerHref: string;
  required: string;
  invalidCredentials: string;
}

interface LoginFormProps {
  /** Inline Server Action: `(prevState, formData) => Promise<FormState>`. */
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  labels: LoginFormLabels;
}

export function LoginForm({ action, labels }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    undefined,
  );

  const fieldErrors = state?.errors ?? {};
  const formError = fieldErrors.form?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {formError ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {formError}
        </p>
      ) : null}

      <Field
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        label={labels.email}
        placeholder={labels.emailPlaceholder}
        required={labels.required}
        errors={fieldErrors.email}
      />

      <Field
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        label={labels.password}
        placeholder={labels.passwordPlaceholder}
        required={labels.required}
        errors={fieldErrors.password}
      />

      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {labels.submit}
      </button>

      <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {labels.noAccount}{" "}
        <Link
          href={labels.registerHref}
          className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
        >
          {labels.registerLink}
        </Link>
      </p>
    </form>
  );
}

// ─── Reusable field ──────────────────────────────────────────────────────────

interface FieldProps {
  id: string;
  name: string;
  type: "text" | "email" | "password";
  label: string;
  placeholder?: string;
  autoComplete?: string;
  required: string;
  errors?: string[];
}

function Field({
  id,
  name,
  type,
  label,
  placeholder,
  autoComplete,
  required,
  errors,
}: FieldProps) {
  const hasErrors = errors && errors.length > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={hasErrors ? true : undefined}
        aria-describedby={hasErrors ? `${id}-error` : undefined}
        required
        className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-50 dark:focus:ring-zinc-50/10"
      />
      {hasErrors ? (
        <p
          id={`${id}-error`}
          className="text-xs text-red-600 dark:text-red-400"
          aria-live="polite"
        >
          {errors[0]}
        </p>
      ) : null}
      <span className="sr-only">{required}</span>
    </div>
  );
}
