import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Property-based tests can be CPU-heavy; give them room.
    testTimeout: 30_000,
    // Global setup file that mocks `server-only` and other Next.js-only
    // packages before any service imports are resolved.
    setupFiles: ["vitest.setup.ts"],
  },
});
