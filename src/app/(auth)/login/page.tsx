import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { auth, signIn } from "@/auth";
import {
  LoginSchema,
  type FormState,
  type LoginInput,
} from "@/lib/validation/schemas";
import { createTranslator } from "@/i18n/utils";
import { getLocale } from "@/i18n/server";

import { LoginForm } from "./LoginForm";

/**
 * Login page — Server Component.
 *
 * Renders the locale-aware heading/labels (Requirement 2.5) and hosts the
 * `loginAction` inline Server Action (Requirement 1.3) used by the client
 * form. Authentication is delegated to Auth.js (`signIn`) so the resulting
 * encrypted JWT cookie is recognised by the middleware / `auth()` helper.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.8, 2.5
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

// ─── Server Action: loginAction ──────────────────────────────────────────────

/**
 * Validate the submitted credentials with Zod, then authenticate via Auth.js.
 *
 * On success a `redirect("/dashboard")` is thrown (Next.js intercepts it);
 * on failure the form state is returned with inline field/credential errors
 * (Requirements 1.3, 1.4).
 */
async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const locale = await getLocale();
  const t = createTranslator(locale);

  const parsed = LoginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { errors: collectFieldErrors(parsed.error.issues as ZodIssueLike[]) };
  }
  const { email, password } = parsed.data as LoginInput;

  try {
    // Establish the Auth.js JWT session (sets the encrypted session cookie).
    // `redirect: false` lets us control navigation ourselves.
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    // NEXT_REDIRECT is thrown by signIn to perform the redirect — re-throw so
    // Next.js can complete the client-side navigation.
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    // Any AuthError (bad credentials, etc.) → unified credential error message
    // so we never leak whether the email exists (Requirement 1.4).
    if (error instanceof AuthError) {
      return { errors: { form: [t("auth.login.invalidCredentials")] } };
    }
    return { errors: { form: [t("error.generic")] } };
  }

  // Defensive fallback if signIn neither redirected nor threw.
  redirect("/dashboard");
}

// ─── Page (Server Component) ─────────────────────────────────────────────────

export default async function LoginPage() {
  const locale = await getLocale();
  const t = createTranslator(locale);

  // Already-authenticated users are bounced to the dashboard (middleware also
  // enforces this, the guard here keeps deep links consistent).
  const session = await auth();
  if (session?.user) {
    const headerList = await headers();
    redirect(headerList.get("x-pathname") ?? "/dashboard");
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {t("auth.login.title")}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("auth.login.subtitle")}
        </p>
      </header>

      <LoginForm
        action={loginAction}
        labels={{
          email: t("auth.login.emailLabel"),
          emailPlaceholder: t("auth.login.emailPlaceholder"),
          password: t("auth.login.passwordLabel"),
          passwordPlaceholder: t("auth.login.passwordPlaceholder"),
          submit: t("auth.login.submit"),
          noAccount: t("auth.login.noAccount"),
          registerLink: t("auth.login.registerLink"),
          registerHref: "/register",
          required: t("common.required"),
          invalidCredentials: t("auth.login.invalidCredentials"),
        }}
      />
    </div>
  );
}
