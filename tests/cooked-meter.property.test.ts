import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import fc from "fast-check";

import { resetInMemoryDb } from "./helpers/store";
import { buildInMemoryClient } from "./helpers/in-memory-db";

const { mockDb } = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    mockDb: {
      task: {
        findUnique: fn(),
        findUniqueOrThrow: fn(),
        findMany: fn(),
        create: fn(),
        update: fn(),
      },
      userTaskProgress: {
        findUnique: fn(),
        findMany: fn(),
        create: fn(),
        createMany: fn(),
        update: fn(),
      },
      cookedScore: {
        findMany: fn(),
        upsert: fn(),
      },
      taskOverride: { create: fn() },
      taskEditLog: { createMany: fn() },
      classRoom: { findUnique: fn() },
      classRoomMember: { findUnique: fn(), findMany: fn() },
      $transaction: fn(),
    },
  };
});

let client: ReturnType<typeof buildInMemoryClient>;

function bind(stub: Record<string, any>, real: Record<string, any>) {
  for (const key of Object.keys(real)) {
    const realMember = real[key];
    const stubMember = stub[key];
    if (typeof realMember === "function") {
      if (stubMember) {
        (stubMember as Mock).mockImplementation(
          (realMember as (...a: unknown[]) => unknown).bind(real)
        );
      }
    } else if (realMember && typeof realMember === "object" && stubMember) {
      bind(
        stubMember as Record<string, unknown>,
        realMember as Record<string, unknown>
      );
    }
  }
}

function hydrateMock() {
  client = buildInMemoryClient();
  vi.clearAllMocks();
  bind(
    mockDb as unknown as Record<string, unknown>,
    client as unknown as Record<string, unknown>
  );
}

vi.mock("@/lib/db", () => ({
  db: mockDb,
  baseDb: mockDb,
  withUserContext: async (_userId: string, fn: () => unknown) => fn(),
}));

import { CookedMeterService } from "@/lib/services/cooked-meter.service";

beforeEach(() => {
  resetInMemoryDb();
  hydrateMock();
});

const NOW = new Date("2026-06-23T12:00:00Z");

describe("Feature: project005-task-management-dss", () => {
  // ─── Property 12: Cooked Tier Classification by Score Range ──────────────────
  describe("Property 12: Cooked Tier Classification by Score Range", () => {
    it("maps scores to correct CookedTier according to ranges, including boundary cases", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 15000 }), (score) => {
          const tier = CookedMeterService.determineTier(score);
          if (score <= 2000) {
            expect(tier).toBe("MAIN_CHARACTER");
          } else if (score <= 5000) {
            expect(tier).toBe("LET_HIM_COOK");
          } else if (score <= 8000) {
            expect(tier).toBe("SLIGHTLY_COOKED");
          } else {
            expect(tier).toBe("OVERCOOKED");
          }
        }),
        { numRuns: 500 }
      );

      // Explicit boundary testing (Requirement 6.3 - 6.6)
      expect(CookedMeterService.determineTier(0)).toBe("MAIN_CHARACTER");
      expect(CookedMeterService.determineTier(2000)).toBe("MAIN_CHARACTER");
      expect(CookedMeterService.determineTier(2001)).toBe("LET_HIM_COOK");
      expect(CookedMeterService.determineTier(5000)).toBe("LET_HIM_COOK");
      expect(CookedMeterService.determineTier(5001)).toBe("SLIGHTLY_COOKED");
      expect(CookedMeterService.determineTier(8000)).toBe("SLIGHTLY_COOKED");
      expect(CookedMeterService.determineTier(8001)).toBe("OVERCOOKED");
      expect(CookedMeterService.determineTier(12000)).toBe("OVERCOOKED");
    });
  });

  // NOTE: Property 13 (Recovery Mode Activation Threshold) and Property 14
  // (Task Breakdown Creates Micro-Tasks) are Recovery Mode concerns and live
  // in `tests/recovery-mode.property.test.ts` (Task 4.4), per the blueprint.
});
