/**
 * i18n module barrel export.
 *
 * Single entry-point for all i18n utilities, constants, and the client-side
 * context provider / hook.
 */

// Configuration constants
export {
  BCP47_TO_LOCALE,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  LOCALE_TO_BCP47,
  SUPPORTED_LOCALES,
} from "./config";

// Utility functions (server + edge compatible)
export {
  createTranslator,
  detectLocale,
  formatDate,
  formatRelativeTime,
  getTranslation,
  loadDictionary,
  type Dictionary,
} from "./utils";

// Client-side context (re-exported for convenience but consumers importing
// from "use client" files should import directly from "./LocaleProvider").
export { LocaleProvider, useTranslation } from "./LocaleProvider";
