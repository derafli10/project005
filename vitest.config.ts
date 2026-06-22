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
    // Mock `server-only` so service files that import it can be loaded in
    // vitest (a non-Next.js environment).
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
  },
});
