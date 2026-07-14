-- ============================================================================
-- EXPLAIN ANALYZE Scripts for Critical Queries
-- Task 21.1: Verify index performance on production database
--
-- Run these queries against the PostgreSQL database after migration.
-- Each query includes the expected index usage and performance target.
-- ============================================================================

-- ─── 1. TASK QUEUE QUERY ────────────────────────────────────────────────────
-- Most frequent query: Fetch user's task queue via UserTaskProgress bridge.
-- Expected index: UserTaskProgress_userId_status_idx
-- Target: < 5ms for 10,000 tasks per user
-- ────────────────────────────────────────────────────────────────────────────

EXPLAIN ANALYZE
SELECT
  utp."userId",
  utp."taskId",
  utp."status",
  utp."position",
  utp."completedAt",
  t."id",
  t."title",
  t."description",
  t."sksWeight",
  t."taskWeight",
  t."deadlineAt",
  t."isSubTask",
  t."parentTaskId",
  t."classRoomId",
  t."creatorId",
  t."createdAt",
  t."updatedAt"
FROM "UserTaskProgress" utp
JOIN "Task" t ON utp."taskId" = t."id"
WHERE utp."userId" = 'REPLACE_WITH_USER_ID'
  AND utp."status" IN ('PENDING', 'IN_PROGRESS')
ORDER BY utp."position" ASC NULLS LAST, t."deadlineAt" ASC;

-- Expected plan: Index Scan using UserTaskProgress_userId_status_idx
-- If seeing Seq Scan, verify the composite index [userId, status] exists.


-- ─── 2. COOKED METER / CUMULATIVE SCORE CALCULATION ────────────────────────
-- Purpose: Fetch non-completed parent tasks with deadline in next 7 days
-- Expected index: UserTaskProgress_userId_status_idx + Task_deadlineAt_idx
-- Target: < 10ms
-- ────────────────────────────────────────────────────────────────────────────

EXPLAIN ANALYZE
SELECT
  t."id",
  t."sksWeight",
  t."taskWeight",
  t."deadlineAt"
FROM "UserTaskProgress" utp
JOIN "Task" t ON utp."taskId" = t."id"
WHERE utp."userId" = 'REPLACE_WITH_USER_ID'
  AND utp."status" IN ('PENDING', 'IN_PROGRESS')
  AND t."isSubTask" = false
  AND t."deadlineAt" > NOW()
  AND t."deadlineAt" <= NOW() + INTERVAL '7 days';

-- Expected plan: Index Scan on UserTaskProgress_userId_status_idx
--                + Nested Loop with Index Scan on Task_pkey
-- The deadlineAt filter is applied after the join via the Task_deadlineAt_idx.


-- ─── 3. SPARKLINE / COOKED SCORE HISTORY ────────────────────────────────────
-- Purpose: Fetch 7 days of historical stress scores
-- Expected index: CookedScore_userId_date_idx
-- Target: < 2ms
-- ────────────────────────────────────────────────────────────────────────────

EXPLAIN ANALYZE
SELECT "date", "cumulativeScore", "tier"
FROM "CookedScore"
WHERE "userId" = 'REPLACE_WITH_USER_ID'
  AND "date" >= CURRENT_DATE - INTERVAL '7 days'
  AND "date" <= CURRENT_DATE
ORDER BY "date" ASC;

-- Expected plan: Index Scan using CookedScore_userId_date_idx
-- Very efficient: at most 7 rows returned.


-- ─── 4. CLASSROOM FEED QUERY ────────────────────────────────────────────────
-- Purpose: Fetch recent posts with tag filtering
-- Expected indexes: AnonymousPost_classRoomId_tag_idx,
--                   AnonymousPost_classRoomId_createdAt_idx
-- Target: < 5ms for 1000 posts per classroom
-- ────────────────────────────────────────────────────────────────────────────

-- 4a. Feed with tag filter (uses [classRoomId, tag] composite index)
EXPLAIN ANALYZE
SELECT "id", "content", "tag", "createdAt"
FROM "AnonymousPost"
WHERE "classRoomId" = 'REPLACE_WITH_CLASSROOM_ID'
  AND "tag" = 'CURHAT_TUGAS'
ORDER BY "createdAt" DESC
LIMIT 50;

-- 4b. Feed without tag filter (uses [classRoomId, createdAt] composite index)
EXPLAIN ANALYZE
SELECT "id", "content", "tag", "createdAt"
FROM "AnonymousPost"
WHERE "classRoomId" = 'REPLACE_WITH_CLASSROOM_ID'
ORDER BY "createdAt" DESC
LIMIT 50;

-- Expected plan: Index Scan using the respective composite index
-- 4a should use AnonymousPost_classRoomId_tag_idx
-- 4b should use AnonymousPost_classRoomId_createdAt_idx


-- ─── 5. UNREAD NOTIFICATIONS QUERY ─────────────────────────────────────────
-- Purpose: Count/fetch unread task edit log entries for a user
-- Expected indexes: TaskEditLogRead_userId_isRead_idx
-- Target: < 5ms
-- ────────────────────────────────────────────────────────────────────────────

EXPLAIN ANALYZE
SELECT tel."id", tel."taskId"
FROM "TaskEditLog" tel
WHERE tel."taskId" IN (
    SELECT utp."taskId"
    FROM "UserTaskProgress" utp
    WHERE utp."userId" = 'REPLACE_WITH_USER_ID'
)
  AND tel."editorId" != 'REPLACE_WITH_USER_ID'
  AND NOT EXISTS (
    SELECT 1
    FROM "TaskEditLogRead" telr
    WHERE telr."logId" = tel."id"
      AND telr."userId" = 'REPLACE_WITH_USER_ID'
      AND telr."isRead" = true
  );

-- Expected plan: Index Scan using TaskEditLog_taskId_idx for the subquery,
--                Anti-Join with TaskEditLogRead_userId_isRead_idx


-- ─── 6. DAILY DIGEST IDEMPOTENCY CHECK ─────────────────────────────────────
-- Purpose: Check if digest was already sent today
-- Expected index: DailyDigestLog_userId_digestDate_key (unique)
-- Target: < 1ms
-- ────────────────────────────────────────────────────────────────────────────

EXPLAIN ANALYZE
SELECT "id", "deliveryStatus"
FROM "DailyDigestLog"
WHERE "userId" = 'REPLACE_WITH_USER_ID'
  AND "digestDate" = CURRENT_DATE;

-- Expected plan: Index Scan using DailyDigestLog_userId_digestDate_key
-- Unique index lookup = O(1).


-- ============================================================================
-- INDEX VERIFICATION
-- Run this to confirm all expected indexes exist after migration.
-- ============================================================================

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
