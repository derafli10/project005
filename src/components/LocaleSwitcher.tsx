"use client";

/**
 * LocaleSwitcher — Client Component.
 *
 * A compact, accessible toggle that switches the active UI language between
 * English (EN) and Bahasa Indonesia (ID).
 *
 * Behaviour (Requirements 2.1, 2.2, 2.3, 2.6, 2.7, 2.8):
 *  - Displays the *current* locale with a globe icon + code label so the
 *    active language is visually identifiable (Requirement 2.8).
 *  - Toggling flips EN ↔ ID and:
 *      1. Persists the preference via {@link switchLocaleAction} (database
 *         `User.locale` + live Auth.js JWT — Requirement 2.6).
 *      2. Writes the `NEXT_LOCALE` cookie so middleware picks up the new
 *         locale on the very next request (Requirement 2.3).
 *      3. Calls `router.refresh()` to re-render Server Components in the new
 *         language WITHOUT a full navigation — client state (e.g. Task Queue,
 *         form inputs) is preserved (Requirement 2.7).
 *
 * All visible strings are injected via props from the Server Component so the
 * switcher itself stays locale-agnostic until render (Requirement 2.5).
 *
 * Reference: tasks.md 9.3, design.md > LocaleSwitcher.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";

import { switchLocaleAction } from "@/app/actions/locale";
import { LOCALE_COOKIE_NAME } from "@/i18n/config";
import type { Locale } from "@/generated/prisma";

// ─── TYPES ──────────────────────────────────────────────────────────────────

/** The two locales this switcher toggles between. */
const LOCALES = ["EN", "ID"] as const;

/** Per-locale display metadata (flag-style glyph + short label). */
const LOCALE_META: Record<Locale, { flag: string; label: string }> = {
  EN: { flag: "🇬🇧", label: "EN" },
  ID: { flag: "🇮🇩", label: "ID" },
};

export interface LocaleSwitcherLabels {
  /** Accessible label for the whole control (e.g. "Language"). */
  ariaLabel: string;
  /** Short hint shown next to the current locale (e.g. "Switch to"). */
  switchToHint: string;
  /** Full display name of the *other* locale (e.g. "Bahasa Indonesia"). */
  otherLocaleName: string;
}

interface LocaleSwitcherProps {
  /** The locale resolved server-side for the current request. */
  currentLocale: Locale;
  /** Pre-resolved, localized visible strings. */
  labels: LocaleSwitcherLabels;
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────

export function LocaleSwitcher({
  currentLocale,
  labels,
}: LocaleSwitcherProps): React.ReactNode {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The locale we will switch *to* when toggled.
  const targetLocale: Locale =
    currentLocale === "EN" ? "ID" : "EN";
  const targetMeta = LOCALE_META[targetLocale];
  const currentMeta = LOCALE_META[currentLocale];

  async function handleToggle(): Promise<void> {
    // Optimistic cookie write so middleware resolves the new locale
    // immediately on `router.refresh()` (Requirement 2.3).
    document.cookie = `${LOCALE_COOKIE_NAME}=${targetLocale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=strict${process.env.NODE_ENV === "production" ? "; secure" : ""}`;

    startTransition(() => {
      // Persist to DB + Auth.js session (Requirement 2.6).
      switchLocaleAction(targetLocale)
        .then(() => {
          // Re-fetch Server Component data and re-render in the new locale
          // WITHOUT navigating away — client state is preserved (Requirement 2.7).
          router.refresh();
        })
        .catch(() => {
          // Roll back the optimistic cookie so a failed switch does not stick.
          document.cookie = `${LOCALE_COOKIE_NAME}=${currentLocale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=strict${process.env.NODE_ENV === "production" ? "; secure" : ""}`;
        });
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-label={`${labels.switchToHint} ${labels.otherLocaleName}`}
      title={labels.ariaLabel}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-hidden="true">{currentMeta.flag}</span>
      <span className="tabular-nums">{currentMeta.label}</span>
      <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-500">
        →
      </span>
      <span aria-hidden="true">{targetMeta.flag}</span>
      <span className="sr-only">
        {labels.switchToHint} {labels.otherLocaleName}
      </span>
    </button>
  );
}
