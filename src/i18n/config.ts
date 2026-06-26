/**
 * i18n configuration constants.
 *
 * Centralised locale definitions consumed by middleware, utilities, and
 * context providers.  Keeps the magic strings in one place so the rest of
 * the codebase works with the Locale enum from Prisma.
 */

import type { Locale } from "@/generated/prisma";

/** Ordered list of supported locales (first entry is the fallback). */
export const SUPPORTED_LOCALES: readonly Locale[] = ["EN", "ID"] as const;

/** Default locale used when no preference can be resolved. */
export const DEFAULT_LOCALE: Locale = "EN";

/**
 * Maps the Prisma `Locale` enum values to BCP-47 language tags expected by
 * `Intl`, `@formatjs/intl-localematcher`, and the `negotiator` library.
 */
export const LOCALE_TO_BCP47: Record<Locale, string> = {
  EN: "en",
  ID: "id",
} as const;

/**
 * Reverse map: BCP-47 → Prisma Locale enum.
 */
export const BCP47_TO_LOCALE: Record<string, Locale> = {
  en: "EN",
  id: "ID",
} as const;

/** Cookie name used to persist the user's locale preference on the client. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE" as const;

/** Custom header injected by middleware so Server Components can read it. */
export const LOCALE_HEADER_NAME = "x-locale" as const;
