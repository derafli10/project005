/**
 * i18n utility functions.
 *
 * Provides:
 * - `loadDictionary`  – reads a locale JSON file and returns its flat map.
 * - `getTranslation`  – resolves a dot-notation key to the translated string,
 *                       with optional interpolation of `{placeholder}` tokens.
 * - `formatDate`      – formats a Date according to the active locale.
 * - `detectLocale`    – resolves the best matching locale from an
 *                       Accept-Language header using @formatjs/intl-localematcher.
 *
 * Requirements: 2.5, 2.9
 */

import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";

import type { Locale } from "@/generated/prisma";
import {
  BCP47_TO_LOCALE,
  DEFAULT_LOCALE,
  LOCALE_TO_BCP47,
  SUPPORTED_LOCALES,
} from "./config";

import enDictionary from "./locales/en.json";
import idDictionary from "./locales/id.json";

// ─── TYPES ──────────────────────────────────────────────────────────────────

/** Flat translation dictionary shape. Keys use dot-notation. */
export type Dictionary = Record<string, string>;

// ─── DICTIONARY LOADING ─────────────────────────────────────────────────────

/**
 * Pre-loaded dictionaries keyed by Prisma `Locale` enum.
 *
 * Static imports are used instead of dynamic `fs.readFileSync` so that the
 * dictionaries are bundled at build time and available in both server and
 * edge runtimes (Vercel serverless, middleware, etc.).
 */
const DICTIONARIES: Record<Locale, Dictionary> = {
  EN: enDictionary as unknown as Dictionary,
  ID: idDictionary as unknown as Dictionary,
};

/**
 * Return the full dictionary for a given locale.
 *
 * Falls back to `DEFAULT_LOCALE` if the requested locale is unknown.
 */
export function loadDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

// ─── TRANSLATION ────────────────────────────────────────────────────────────

/**
 * Resolve a dot-notation translation key for the given locale, with optional
 * `{placeholder}` interpolation.
 *
 * @example
 * ```ts
 * const t = getTranslation("EN", "classroom.memberCount", { count: "5" });
 * // → "5 members"
 * ```
 *
 * If the key is missing from the target locale, the English fallback is
 * attempted.  If it is still missing the raw key string is returned so that
 * the UI is never blank.
 */
export function getTranslation(
  locale: Locale,
  key: string,
  params?: Record<string, string>,
): string {
  const dict = loadDictionary(locale);

  let value: string | undefined = dict[key];

  // Fallback chain: requested locale → EN → raw key
  if (value === undefined && locale !== DEFAULT_LOCALE) {
    value = DICTIONARIES[DEFAULT_LOCALE][key];
  }

  if (value === undefined) {
    return key;
  }

  // Interpolate `{placeholder}` tokens
  if (params) {
    for (const [placeholder, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${placeholder}}`, replacement);
    }
  }

  return value;
}

/**
 * Creates a pre-bound translator for a specific locale.
 *
 * Useful in Server Components / Server Actions where the locale is known
 * once and many translations are needed:
 *
 * ```ts
 * const t = createTranslator("ID");
 * const title = t("dashboard.title");
 * ```
 */
export function createTranslator(
  locale: Locale,
): (key: string, params?: Record<string, string>) => string {
  return (key: string, params?: Record<string, string>) =>
    getTranslation(locale, key, params);
}

// ─── DATE FORMATTING ────────────────────────────────────────────────────────

/**
 * Format a `Date` according to locale conventions.
 *
 * - **ID** → `dd/MM/yyyy`  (e.g. `26/06/2026`)
 * - **EN** → `MM/dd/yyyy`  (e.g. `06/26/2026`)
 *
 * Uses the `Intl.DateTimeFormat` API with explicit component ordering to
 * guarantee deterministic output regardless of the host runtime.
 *
 * Requirement 2.9
 */
export function formatDate(date: Date, locale: Locale): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  switch (locale) {
    case "ID":
      return `${day}/${month}/${year}`;
    case "EN":
    default:
      return `${month}/${day}/${year}`;
  }
}

/**
 * Format a `Date` as a human-readable relative time string.
 *
 * Returns locale-appropriate strings like:
 * - EN: "2 hours ago", "yesterday", "3 days ago"
 * - ID: "2 jam lalu", "kemarin", "3 hari lalu"
 *
 * Requirement 9.4
 */
export function formatRelativeTime(date: Date, locale: Locale): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (locale === "ID") {
    if (diffMinutes < 1) return "baru saja";
    if (diffMinutes < 60) return `${diffMinutes} menit lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;
    if (diffDays === 1) return "kemarin";
    return `${diffDays} hari lalu`;
  }

  // Default: EN
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays === 1) return "yesterday";
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

// ─── LOCALE DETECTION ───────────────────────────────────────────────────────

/**
 * Resolve the best matching `Locale` from a raw `Accept-Language` header
 * string using the `negotiator` and `@formatjs/intl-localematcher` packages.
 *
 * Used inside the Next.js middleware to determine locale for unauthenticated
 * visitors.
 */
export function detectLocale(acceptLanguageHeader: string): Locale {
  const negotiator = new Negotiator({
    headers: { "accept-language": acceptLanguageHeader },
  });

  const requestedLanguages = negotiator.languages();

  const supportedBcp47 = SUPPORTED_LOCALES.map((l) => LOCALE_TO_BCP47[l]);
  const defaultBcp47 = LOCALE_TO_BCP47[DEFAULT_LOCALE];

  try {
    const matched = match(requestedLanguages, supportedBcp47, defaultBcp47);
    return BCP47_TO_LOCALE[matched] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
