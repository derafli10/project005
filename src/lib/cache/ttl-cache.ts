import "server-only";

/**
 * Lightweight in-memory TTL cache for server-side data.
 *
 * Used to cache expensive JIT computations (e.g., Cooked Meter cumulative
 * score) for a short duration, reducing CPU load on rapid successive requests
 * within the same serverless invocation.
 *
 * Design constraints:
 *  - Short TTLs only (default 60s) — this is NOT a distributed cache.
 *  - No persistence across serverless cold starts — intentional.
 *  - Max entries guard prevents unbounded memory growth in long-lived dev
 *    server processes.
 *  - Stale entries are lazily evicted on `get()` or eagerly pruned when the
 *    max-entries cap is hit.
 *
 * Reference: Task 21.2 — Cache JIT priority calculations for 1 minute.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  /**
   * @param ttlMs       Time-to-live in milliseconds (default: 60_000 = 1 min).
   * @param maxEntries  Maximum cached entries before oldest are pruned (default: 1000).
   */
  constructor(ttlMs = 60_000, maxEntries = 1000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /** Retrieve a cached value. Returns `undefined` if missing or expired. */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /** Store a value. Auto-prunes if the cache exceeds `maxEntries`. */
  set(key: string, value: T): void {
    // Prune expired entries when nearing capacity.
    if (this.cache.size >= this.maxEntries) {
      this.prune();
    }

    // If still at capacity after pruning, evict the oldest entry.
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Invalidate a specific key. */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Invalidate all keys matching a prefix (e.g., userId). */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Remove all expired entries. */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /** Current number of entries (including potentially expired). */
  get size(): number {
    return this.cache.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }
}
