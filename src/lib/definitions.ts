/**
 * Shared library barrel.
 *
 * Re-exports the validation schemas and domain error classes so callers can
 * import from a single `@/lib/definitions` entry point if desired.
 */
export * from "./validation/schemas";
export * from "./errors/domain-errors";
