import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { AuthService } from "@/lib/services/auth.service";
import {
  ConflictError,
  ValidationError,
} from "@/lib/errors/domain-errors";
import {
  SignupSchema,
  type FormState,
  type SignupInput,
} from "@/lib/validation/schemas";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

import { RegisterForm } from "./RegisterForm";

/**
 * Registration page — Server Component.
 *
 * Renders locale-aware headings/labels (Requirement 2.5) and hosts the
 * `registerAction` inline Server Action used by the client form. On success it
 * immediately establishes an Auth.js session and redirects to the dashboard
 * (Requirements 1.1, 1.2, 1.8).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 2.5
 */

/** Minimal structural view of a Zod issue (version-agnostic). */
type ZodIssueLike = { path: PropertyKey[]; message: string };

/** Fold Zod issues into a `{ field: messages }` record for inline display. */
function collectFieldErrors(issues: ZodIssueLike[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

// ─── Server Action: registerAction ───────────────────────────────────────────

/**
 * Validate input with Zod, create the user via AuthService, then sign them in.
 *
 * On success the new account is created (Requirement 1.1) and an Auth.js
 * session is established before redirecting to `/dashboard`. On failure the
 * form is re-rendered with inline errors (duplicate email → Requirement 1.2).
 */
async function registerAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const parsed = SignupSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { errors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]) };
  }
  const { name, email, password } = parsed.data as SignupInput;

  try {
    await AuthService.register(name, email, password);
  } catch (err) {
    // Duplicate email → Requirement 1.2.
    if (err instanceof ConflictError) {
      return { errors: { email: [t("auth.register.emailExists")] } };
    }
    // Any other validation issue raised by the service.
    if (err instanceof ValidationError) {
      const field =
        (err.details?.field as string | undefined) ?? "form";
      return { errors: { [field]: [err.message] } };
    }
    return { errors: { form: [t("error.generic")] } };
  }

  // Auto-login: establish the Auth.js session and navigate to the dashboard.
  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    // NEXT_REDIRECT is thrown to perform the redirect — re-throw it.
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    // If auto-login fails for any reason, send the user to the login page so
    // they can authenticate manually rather than being stranded.
    redirect("/login");
  }

  redirect("/dashboard");
}

// ─── Page (Server Component) ─────────────────────────────────────────────────

export default async function RegisterPage() {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Already-authenticated users are bounced to the dashboard.
  const session = await auth();
  if (session?.user) {
    const headerList = await headers();
    redirect(headerList.get("x-pathname") ?? "/dashboard");
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {t("auth.register.title")}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("auth.register.subtitle")}
        </p>
      </header>

      <RegisterForm
        action={registerAction}
        labels={{
          name: t("auth.register.nameLabel"),
          namePlaceholder: t("auth.register.namePlaceholder"),
          email: t("auth.register.emailLabel"),
          emailPlaceholder: t("auth.register.emailPlaceholder"),
          password: t("auth.register.passwordLabel"),
          passwordPlaceholder: t("auth.register.passwordPlaceholder"),
          passwordHint: t("auth.register.passwordHint"),
          submit: t("auth.register.submit"),
          haveAccount: t("auth.register.haveAccount"),
          loginLink: t("auth.register.loginLink"),
          loginHref: "/login",
          required: t("common.required"),
        }}
      />
    </div>
  );
}
