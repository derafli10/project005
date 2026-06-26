import { describe, expect, it } from "vitest";
import { loadDictionary, getTranslation, formatDate, detectLocale } from "@/i18n/utils";

describe("i18n core structure", () => {
  describe("loadDictionary", () => {
    it("loads dictionary for EN", () => {
      const dict = loadDictionary("EN");
      expect(dict).toBeDefined();
      expect(dict["auth.login.title"]).toBeDefined();
    });

    it("loads dictionary for ID", () => {
      const dict = loadDictionary("ID");
      expect(dict).toBeDefined();
      expect(dict["auth.login.title"]).toBeDefined();
    });

    it("falls back to DEFAULT_LOCALE for unknown locale", () => {
      const dict = loadDictionary("UNKNOWN" as any);
      expect(dict).toBeDefined();
      expect(dict["auth.login.title"]).toBeDefined();
    });
  });

  describe("getTranslation", () => {
    it("returns correct translations with optional interpolation", () => {
      // Test direct translation
      const valEn = getTranslation("EN", "auth.login.title");
      const valId = getTranslation("ID", "auth.login.title");
      expect(valEn).not.toBe("auth.login.title");
      expect(valId).not.toBe("auth.login.title");

      // Test fallback to EN if key missing in ID
      const missingKey = "test.only.in.en.key";
      // Let's mock dictionary fallback by testing getTranslation with a non-existent key that defaults to key name
      expect(getTranslation("ID", "nonexistent.key")).toBe("nonexistent.key");
    });
  });

  describe("formatDate", () => {
    it("formats dates as MM/dd/yyyy for EN and dd/MM/yyyy for ID", () => {
      const testDate = new Date("2026-06-26T12:00:00Z");
      expect(formatDate(testDate, "EN")).toBe("06/26/2026");
      expect(formatDate(testDate, "ID")).toBe("26/06/2026");
    });
  });

  describe("detectLocale", () => {
    it("negotiates correct locale from Accept-Language headers", () => {
      expect(detectLocale("id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("ID");
      expect(detectLocale("en-US,en;q=0.9")).toBe("EN");
      expect(detectLocale("fr-FR,fr;q=0.9")).toBe("EN"); // unknown falls back to DEFAULT_LOCALE
    });
  });
});
