import "server-only";

/**
 * Server-side locale resolver.
 *
 * Reads the active locale from:
 *   1. The custom `x-locale` header injected by middleware.
 *   2. Falls back to the session token's locale claim.
 *   3. Final fallback to DEFAULT_LOCALE.
 *
 * This module is `server-only` — it must never be imported in client code.
 *
 * Requirements: 2.3, 2.5
 */

import { headers } from "next/headers";
import { auth } from "@/auth";

import type { Locale } from "@/generated/prisma";
import { DEFAULT_LOCALE, LOCALE_HEADER_NAME } from "./config";
import { loadDictionary, type Dictionary } from "./utils";

/**
 * Resolve the current request's locale.
 *
 * Intended for use inside Server Components, Server Actions, and Route
 * Handlers where `headers()` is available.
 */
export async function getLocale(): Promise<Locale> {
  // 1. Try the custom header set by middleware
  const requestHeaders = await headers();
  const headerLocale = requestHeaders.get(LOCALE_HEADER_NAME);
  if (headerLocale === "EN" || headerLocale === "ID") {
    return headerLocale;
  }

  // 2. Try the session
  const session = await auth();
  const sessionLocale = (session?.user as { locale?: string } | undefined)?.locale;
  if (sessionLocale === "EN" || sessionLocale === "ID") {
    return sessionLocale;
  }

  // 3. Fallback
  return DEFAULT_LOCALE;
}

/**
 * Convenience: resolve locale AND load the matching dictionary in one call.
 *
 * Useful in layouts and pages that need to pass the dictionary into the
 * `<LocaleProvider>`.
 */
export async function getLocaleWithDictionary(): Promise<{
  locale: Locale;
  dictionary: Dictionary;
}> {
  const locale = await getLocale();
  const dictionary = loadDictionary(locale);
  return { locale, dictionary };
}
