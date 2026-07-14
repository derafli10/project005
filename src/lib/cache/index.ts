/**
 * Cache layer barrel export.
 *
 * Provides:
 *  - TTLCache: Generic in-memory TTL cache for server-side computations.
 *  - Classroom RSC caches: React `cache()` wrappers for request-level
 *    deduplication of classroom queries.
 *
 * Task 21.2.
 */

export { TTLCache } from "./ttl-cache";
export {
  getCachedUserClassrooms,
  getCachedClassroom,
  getCachedClassroomByCode,
  getCachedClassroomMemberCount,
} from "./classroom-cache";
