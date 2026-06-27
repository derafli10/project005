"use server";

/**
 * Locale Server Action.
 *
 * Persists the user's UI language preference (EN / ID) and propagates it into
 * the live Auth.js session so the new locale takes effect immediately —
 * middleware reads the JWT `locale` claim on the next request and injects it
 * via the `x-locale` header so Server Components re-render in the new language
 * without a full re-login (Requirements 2.2, 2.6).
 *
 * Flow:
 *   1. Authorise (must be signed in).
 *   2. Update `User.locale` in the database (source of truth).
 *   3. `unstable_update({ user: { locale } })` → fires the `jwt` callback with
 *      `trigger: "update"`, which writes the new locale into the encrypted JWT.
 *   4. Return the persisted locale so the client can sync its optimistic state.
 *
 * Requirements: 2.2, 2.6
 */

import { auth, unstable_update } from "@/auth";
import { baseDb } from "@/lib/db";
import { AuthenticationError, ValidationError } from "@/lib/errors/domain-errors";
import type { ActionResult, Locale } from "@/lib/validation/schemas";

/** Whitelist of locales accepted by this action. */
const ALLOWED_LOCALES: readonly Locale[] = ["EN", "ID"] as const;

/**
 * Persist a new locale preference for the signed-in user.
 *
 * @param locale The target locale (`EN` or `ID`).
 * @returns `ActionResult<Locale>` — the persisted locale on success.
 */
export async function switchLocaleAction(
  locale: Locale,
): Promise<ActionResult<Locale>> {
  // 1. Authorise — only authenticated users can persist a preference.
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthenticationError("You must be signed in to change your locale");
  }
  const userId = session.user.id;

  // 2. Validate the requested locale (defence-in-depth against untrusted input).
  if (!ALLOWED_LOCALES.includes(locale)) {
    throw new ValidationError(`Unsupported locale: ${locale}`, { field: "locale" });
  }

  // 3. Persist to the User record (source of truth).
  await baseDb.user.update({
    where: { id: userId },
    data: { locale },
    select: { id: true }, // minimal projection
  });

  // 4. Propagate into the live Auth.js session (JWT) so middleware picks it up
  //    on the next request without forcing a re-login. The `jwt` callback in
  //    `auth.config.ts` whitelists the locale before writing it to the token.
  await unstable_update({ user: { locale } });

  return { success: true, data: locale };
}
