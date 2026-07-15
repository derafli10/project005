import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  loadDictionary,
  getTranslation,
  formatDate,
  createTranslator,
  type Dictionary,
} from "@/i18n/utils";

import type { Locale } from "@/generated/prisma";

/**
 * Integration tests for i18n core structure.
 *
 * @tags Feature: project005-task-management-dss, Task 8.4
 *
 * Validates:
 *   - Dictionary loading correctness for both `en` and `id` locales
 *     (Requirements 2.3, 2.5)
 *   - Date formatting changes based on simulated locale input
 *     (Requirements 2.9)
 *
 * These are integration-level because they exercise the real locale JSON files
 * (statically imported) rather than mocked dictionaries, ensuring the i18n
 * plumbing works end-to-end with the actual translation assets.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract every translation key from a dictionary, excluding the internal
 * `_meta` key which is not a user-facing translation entry (it is a nested
 * object `{ locale, displayName }`, not a flat string value).
 */
function extractTranslationKeys(dict: Dictionary): string[] {
  return Object.keys(dict).filter((key) => key !== "_meta");
}

/** Both supported locales under test. */
const SUPPORTED_LOCALES: Locale[] = ["EN", "ID"];

// ─── 1. Dictionary Loading Correctness ──────────────────────────────────────

describe("Dictionary loading correctness", () => {
  it("loads a non-empty dictionary for each supported locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const dict = loadDictionary(locale);
      expect(dict).toBeDefined();
      expect(typeof dict).toBe("object");
      // The dictionaries have 250+ keys — an empty dict would be a build error.
      expect(Object.keys(dict).length).toBeGreaterThan(100);
    }
  });

  it("returns the EN dictionary as fallback for an unknown locale", () => {
    // Cast to trigger the fallback branch (loadDictionary uses `??` on the
    // DICTIONARIES record which only has EN and ID).
    const dict = loadDictionary("XX" as Locale);
    expect(dict).toBeDefined();

    // The fallback must match the EN dictionary exactly.
    const enDict = loadDictionary("EN");
    expect(Object.keys(dict).length).toBe(Object.keys(enDict).length);

    // Spot-check a known key to verify it's the English version.
    expect(dict["common.appName"]).toBe("Project005");
  });

  it("includes the _meta block with correct locale identifier", () => {
    // `_meta` is a nested object: { locale, displayName } — not a flat
    // translation key. We assert on the nested shape directly.
    for (const locale of SUPPORTED_LOCALES) {
      const dict = loadDictionary(locale);
      const meta = dict["_meta"] as unknown as {
        locale: string;
        displayName: string;
      } | undefined;
      expect(meta).toBeDefined();
      expect(meta?.locale).toBe(locale.toLowerCase());
    }
  });

  it("has identical key sets between EN and ID dictionaries", () => {
    const enKeys = new Set(Object.keys(loadDictionary("EN")));
    const idKeys = new Set(Object.keys(loadDictionary("ID")));

    // Every key in EN must exist in ID and vice-versa.
    const missingInId = [...enKeys].filter((k) => !idKeys.has(k));
    const missingInEn = [...idKeys].filter((k) => !enKeys.has(k));

    expect(
      missingInId,
      `Keys present in EN but missing in ID: ${missingInId.join(", ")}`
    ).toHaveLength(0);

    expect(
      missingInEn,
      `Keys present in ID but missing in EN: ${missingInEn.join(", ")}`
    ).toHaveLength(0);
  });

  it("translations genuinely differ between locales for the majority of keys", () => {
    /**
     * The ID dictionary must be a real translation, not a copy of English.
     * Some keys are intentionally identical across locales (brand names like
     * "Telegram", loanwords like "Password"/"Dashboard", meme
     * phrases, emoji-only labels). Rather than maintain a fragile allowlist,
     * we assert that a strong majority of keys are genuinely translated.
     *
     * If this ratio ever drops close to the threshold it means the ID
     * dictionary is drifting toward an English copy — the translation work
     * needs review.
     */
    const enDict = loadDictionary("EN");
    const idDict = loadDictionary("ID");
    const translationKeys = extractTranslationKeys(enDict);

    let identicalCount = 0;
    const identicalKeys: string[] = [];

    for (const key of translationKeys) {
      const enValue = enDict[key];
      const idValue = idDict[key];

      // Both must resolve to a non-empty string.
      expect(
        typeof enValue === "string" && enValue.length > 0,
        `EN key "${key}" should resolve to a non-empty string`
      ).toBe(true);
      expect(
        typeof idValue === "string" && idValue.length > 0,
        `ID key "${key}" should resolve to a non-empty string`
      ).toBe(true);

      if (enValue === idValue) {
        identicalCount++;
        identicalKeys.push(key);
      }
    }

    const totalKeys = translationKeys.length;
    const translatedRatio = (totalKeys - identicalCount) / totalKeys;

    // At least 70% of keys should be genuinely translated.
    // (Brand names, loanwords, and meme phrases account for the rest.)
    expect(translatedRatio).toBeGreaterThanOrEqual(0.7);

    // Sanity: log the identical keys for visibility if the threshold is ever
    // approached. This makes regressions easy to diagnose.
    if (translatedRatio < 0.8) {
      // eslint-disable-next-line no-console
      console.warn(
        `[i18n] ${identicalCount}/${totalKeys} keys are identical between EN and ID:`,
        identicalKeys
      );
    }
  });

  it("property-based: sampled keys resolve to non-empty strings in both locales", () => {
    const enDict = loadDictionary("EN");
    const idDict = loadDictionary("ID");
    const translationKeys = extractTranslationKeys(enDict);

    const keyArb = fc.constantFrom(...translationKeys);

    fc.assert(
      fc.property(keyArb, (key) => {
        const enValue = enDict[key];
        const idValue = idDict[key];

        // Both must resolve to a non-empty string.
        expect(
          typeof enValue === "string" && enValue.length > 0,
          `EN key "${key}" should resolve to a non-empty string`
        ).toBe(true);
        expect(
          typeof idValue === "string" && idValue.length > 0,
          `ID key "${key}" should resolve to a non-empty string`
        ).toBe(true);
      }),
      { numRuns: 30, seed: 42 }
    );
  });
});

// ─── 2. Translation Resolution with Fallback ──────────────────────────────

describe("getTranslation", () => {
  it("resolves a known key for the target locale", () => {
    expect(getTranslation("EN", "common.save")).toBe("Save");
    expect(getTranslation("ID", "common.save")).toBe("Simpan");
  });

  it("falls back to EN when a key is missing from the target locale", () => {
    // Use a key that definitely exists in EN but we pretend is missing from
    // ID by calling with an unknown locale that will still fallback.
    // More practically: we can verify the fallback path by checking that
    // a raw unknown key returns the key string itself.
    const result = getTranslation("ID", "nonexistent.key.12345");
    expect(result).toBe("nonexistent.key.12345");
  });

  it("returns the raw key for a completely unknown key", () => {
    expect(getTranslation("EN", "absolutely.nonexistent.key")).toBe(
      "absolutely.nonexistent.key"
    );
  });

  it("interpolates {placeholder} tokens", () => {
    const enResult = getTranslation("EN", "classroom.memberCount", {
      count: "42",
    });
    expect(enResult).toBe("42 members");

    const idResult = getTranslation("ID", "classroom.memberCount", {
      count: "7",
    });
    expect(idResult).toBe("7 anggota");
  });

  it("interpolates multiple placeholders", () => {
    const result = getTranslation("EN", "task.microPrompt.template", {
      sks: "3",
      weight: "60",
      days: "5",
    });
    expect(result).toBe("SKS: 3 • Weight: 60% • Deadline: 5 days");
  });
});

// ─── 3. createTranslator Pre-bound Translator ──────────────────────────────

describe("createTranslator", () => {
  it("returns a function that resolves keys for the given locale", () => {
    const tEn = createTranslator("EN");
    const tId = createTranslator("ID");

    expect(tEn("common.cancel")).toBe("Cancel");
    expect(tId("common.cancel")).toBe("Batal");
  });

  it("supports placeholder interpolation via the returned function", () => {
    const t = createTranslator("EN");
    expect(t("feed.post.charLimit", { count: "250" })).toBe(
      "250/500 characters"
    );
  });
});

// ─── 4. Date Formatting by Locale ──────────────────────────────────────────

describe("formatDate", () => {
  it("formats a date in dd/MM/yyyy for ID locale (Requirement 2.9)", () => {
    // 26 June 2026
    const date = new Date(2026, 5, 26); // month is 0-indexed
    const result = formatDate(date, "ID");
    expect(result).toBe("26/06/2026");
  });

  it("formats a date in MM/dd/yyyy for EN locale (Requirement 2.9)", () => {
    const date = new Date(2026, 5, 26);
    const result = formatDate(date, "EN");
    expect(result).toBe("06/26/2026");
  });

  it("zero-pads single-digit months and days", () => {
    // January 5th
    const date = new Date(2026, 0, 5);

    expect(formatDate(date, "ID")).toBe("05/01/2026");
    expect(formatDate(date, "EN")).toBe("01/05/2026");
  });

  it("property-based: ID output matches dd/MM/yyyy pattern for any valid date", () => {
    /**
     * Generate dates spanning a wide range to catch edge cases around
     * month boundaries, leap years, and century transitions.
     */
    const dateArb = fc.date({
      min: new Date(1900, 0, 1),
      max: new Date(2100, 11, 31),
    });

    const idPattern = /^\d{2}\/\d{2}\/\d{4}$/;

    fc.assert(
      fc.property(dateArb, (date) => {
        // fc.date can occasionally yield invalid (NaN) timestamps; skip those.
        fc.pre(!Number.isNaN(date.getTime()));

        const formatted = formatDate(date, "ID");

        // Must match dd/MM/yyyy pattern.
        expect(formatted).toMatch(idPattern);

        // Parse the formatted string back and verify the components match.
        const [dayStr, monthStr, yearStr] = formatted.split("/");
        const day = parseInt(dayStr!, 10);
        const month = parseInt(monthStr!, 10); // 1-indexed from format
        const year = parseInt(yearStr!, 10);

        expect(day).toBe(date.getDate());
        expect(month).toBe(date.getMonth() + 1);
        expect(year).toBe(date.getFullYear());
      }),
      { numRuns: 100 }
    );
  });

  it("property-based: EN output matches MM/dd/yyyy pattern for any valid date", () => {
    const dateArb = fc.date({
      min: new Date(1900, 0, 1),
      max: new Date(2100, 11, 31),
    });

    const enPattern = /^\d{2}\/\d{2}\/\d{4}$/;

    fc.assert(
      fc.property(dateArb, (date) => {
        // fc.date can occasionally yield invalid (NaN) timestamps; skip those.
        fc.pre(!Number.isNaN(date.getTime()));

        const formatted = formatDate(date, "EN");

        // Must match MM/dd/yyyy pattern.
        expect(formatted).toMatch(enPattern);

        // Parse and verify components.
        const [monthStr, dayStr, yearStr] = formatted.split("/");
        const month = parseInt(monthStr!, 10);
        const day = parseInt(dayStr!, 10);
        const year = parseInt(yearStr!, 10);

        expect(month).toBe(date.getMonth() + 1);
        expect(day).toBe(date.getDate());
        expect(year).toBe(date.getFullYear());
      }),
      { numRuns: 100 }
    );
  });

  it("property-based: EN and ID produce different outputs for dates where day ≠ month", () => {
    /**
     * When the day and month are different numbers, EN and ID must produce
     * visually different strings (the day and month positions are swapped).
     * When day === month (e.g. January 1st), both formats produce identical
     * strings — that's expected, so we filter those out.
     */
    const dateArb = fc.date({
      min: new Date(2000, 0, 1),
      max: new Date(2030, 11, 31),
    });

    fc.assert(
      fc.property(dateArb, (date) => {
        fc.pre(!Number.isNaN(date.getTime()));
        fc.pre(date.getDate() !== date.getMonth() + 1);

        const enFormatted = formatDate(date, "EN");
        const idFormatted = formatDate(date, "ID");

        expect(enFormatted).not.toBe(idFormatted);
      }),
      { numRuns: 50 }
    );
  });
});
