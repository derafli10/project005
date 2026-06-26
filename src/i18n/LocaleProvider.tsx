"use client";

/**
 * Client-side locale context provider.
 *
 * Transmits the active locale and a pre-loaded dictionary to all descendant
 * client components so they can call `useTranslation()` without prop-drilling.
 *
 * The server-side layout reads the user's locale (from session or cookie),
 * loads the correct dictionary, and passes both into this provider.
 *
 * Requirements: 2.3, 2.5
 */

import {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from "react";

import type { Locale } from "@/generated/prisma";
import type { Dictionary } from "./utils";

// ─── CONTEXT SHAPE ──────────────────────────────────────────────────────────

interface LocaleContextValue {
  /** Active Prisma Locale enum value. */
  locale: Locale;
  /** Flat key → string dictionary for the active locale. */
  dictionary: Dictionary;
  /**
   * Shorthand translator.
   *
   * @example
   * ```tsx
   * const { t } = useTranslation();
   * return <h1>{t("dashboard.title")}</h1>;
   * ```
   */
  t: (key: string, params?: Record<string, string>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

// ─── PROVIDER ───────────────────────────────────────────────────────────────

interface LocaleProviderProps {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}

export function LocaleProvider({
  locale,
  dictionary,
  children,
}: LocaleProviderProps): ReactNode {
  const t = useCallback(
    (key: string, params?: Record<string, string>): string => {
      let value: string | undefined = dictionary[key];

      if (value === undefined) {
        return key;
      }

      if (params) {
        for (const [placeholder, replacement] of Object.entries(params)) {
          value = value.replaceAll(`{${placeholder}}`, replacement);
        }
      }

      return value;
    },
    [dictionary],
  );

  return (
    <LocaleContext value={{ locale, dictionary, t }}>
      {children}
    </LocaleContext>
  );
}

// ─── CONSUMER HOOK ──────────────────────────────────────────────────────────

/**
 * Access the active locale and translator from any client component.
 *
 * @throws If used outside a `<LocaleProvider>`.
 */
export function useTranslation(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error(
      "useTranslation must be used inside a <LocaleProvider>. " +
        "Ensure the root layout wraps children with <LocaleProvider>.",
    );
  }
  return ctx;
}
