/**
 * Vitest global setup.
 *
 * Mocks `server-only` so service files that import it can be loaded in
 * vitest (a non-Next.js runtime). The package is a Next.js guard rail that
 * throws at import time; in tests it should be a no-op.
 */
vi.mock("server-only", () => ({}));
