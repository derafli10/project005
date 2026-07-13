## Implementation Plan: Project005 Task Management DSS

## Overview

This implementation plan translates the design and requirements documents into a series of discrete coding tasks for building an academic task management system with Decision Support System (DSS) capabilities. The system features Just-In-Time priority evaluation, multi-tenant data isolation via Prisma extensions, Recovery Mode with user consent, anonymous classroom feeds with encrypted author tracking, and idempotent daily digest delivery.

**Technology Stack**: Next.js 16 (App Router), React 19, TypeScript, Prisma 7.8.0, PostgreSQL (Neon), Auth.js v5, Tailwind CSS 4, Framer Motion, GSAP

**Architecture Approach**: Server-first rendering with client islands, optimistic UI updates, Many-to-Many task sharing via UserTaskProgress bridge table

## Tasks

- [x] 1. Set up project infrastructure and database schema
  - [x] 1.1 Initialize Prisma with PostgreSQL connection
    - Configure Neon Serverless PostgreSQL connection string in `.env`
    - Initialize Prisma client with `npx prisma init`
    - _Requirements: Requirements 1-13 (Foundation)_
  
  - [x] 1.2 Create comprehensive Prisma schema with all models
    - Implement User, Session, Task, UserTaskProgress, ClassRoom, ClassRoomMember models
    - Implement CookedScore, TaskOverride, TaskEditLog, AnonymousPost, DailyDigestLog models
    - Define enums: TaskStatus, CookedTier, PostTag, DeliveryStatus, UserRole
    - Add composite unique constraints: [userId, taskId], [userId, digestDate], [userId, date]
    - Add indexes for query optimization: classRoomId, creatorId, deadlineAt, parentTaskId
    - _Requirements: 1.7, 3.1, 6.2, 8.1, 10.1, 13.5_
  
  - [x] 1.3 Configure Auth.js v5 with Prisma adapter
    - Install `next-auth@beta` and `@auth/prisma-adapter`
    - Create `src/lib/auth.config.ts` with credentials provider
    - Configure session strategy, cookies (HTTP-only, Secure, SameSite=Strict)
    - Set up middleware for route protection
    - _Requirements: 1.1, 1.3, 1.5_
  
  - [x] 1.4 Set up TypeScript configuration and project structure
    - Create directory structure: `src/lib/services`, `src/lib/validation`, `src/lib/errors`
    - Configure path aliases in `tsconfig.json` (@/lib, @/app, @/components)
    - Install core dependencies: zod, bcryptjs, framer-motion, gsap, recharts, nanoid
    - _Requirements: All (Foundation)_
  
  - [x] 1.5 Create Prisma Client Extension with AsyncLocalStorage context
    - Implement `src/lib/db.ts` with Prisma client initialization
    - Create AsyncLocalStorage-based context store for userId binding
    - Implement `withUserContext` helper function
    - Create Prisma extension with automatic userId filter injection for Task, UserTaskProgress, CookedScore
    - _Requirements: 1.7, Design: Row-Level Security via Prisma Client Extensions_


- [x] 2. Implement core business logic services
  - [x] 2.1 Create domain error classes and validation schemas
    - Implement `src/lib/errors/domain-errors.ts` with DomainError base class
    - Create error types: AuthenticationError, ValidationError, NotFoundError, ConflictError, ExternalServiceError
    - Implement `src/lib/validation/schemas.ts` with Zod schemas for all inputs
    - Define schemas: registerSchema, loginSchema, createTaskSchema, classCodeSchema, anonymousPostSchema
    - _Requirements: 1.1, 1.2, 8.1, 10.3_
  
  - [x] 2.2 Implement Priority Score Engine service with JIT evaluation
    - Create `src/lib/services/priority-engine.service.ts`
    - Implement `calculateTimeUrgency` with three-tier logic: <24h = 10000, 1-7d = exponential decay, >7d = linear
    - Implement `calculatePriorityScore` with formula: (sksWeight × 2000 × 0.4) + (taskWeight × 0.4) + (timeUrgency × 0.2)
    - Implement `batchCalculate` for computing priority scores for task arrays (JIT, no database writes)
    - Implement `generateMicroPrompt` to create human-readable priority explanations
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7_
  
  - [x] 2.3 Write property tests for Priority Engine
    - **Property 7: Priority Score Calculation Formula Correctness**
    - **Property 8: Time Urgency Calculation by Deadline Range**
    - Use fast-check to generate random sksWeight (1-5), taskWeight (0-10000), deadlines
    - Assert formula correctness and range bounds [0, 10000]
    - Tag: `Feature: project005-task-management-dss, Property 7, Property 8`
    - _Requirements: 3.1, 3.4, 3.5, 3.6_
  
  - [x] 2.4 Implement Authentication Service
    - Create `src/lib/services/auth.service.ts`
    - Implement `register` with bcrypt password hashing (10 rounds)
    - Implement `login` with credential validation and session creation
    - Implement `validateSession` for session token verification
    - Implement `logout` to destroy session
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8_
  
  - [x] 2.5 Write property tests for Authentication Service
    - **Property 1: Registration with Valid Credentials Creates Account**
    - **Property 2: Duplicate Email Registration is Rejected**
    - **Property 3: Valid Login Creates Session Token**
    - **Property 4: Invalid Login is Rejected**
    - Generate random valid/invalid emails and passwords
    - Assert account creation, duplicate rejection, session token creation
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [x] 2.6 Implement Task Service with JIT priority sorting
    - Create `src/lib/services/task.service.ts`
    - Implement `createTask` with UserTaskProgress bridge record creation
    - Implement `getUserTasks` with JIT priority calculation and hybrid sorting (position ASC nulls last, priorityScore DESC, deadline ASC)
    - Implement `updateTask` with classroom propagation if classRoomId exists
    - Implement `completeTask` with Academic Comeback detection and stress drop calculation
    - Implement `recordOverride` to save TaskOverride records
    - _Requirements: 4.1, 4.2, 4.3, 4.7, 4.9, 5.1, 5.6_

  - [x] 2.7 Write property tests for Task Service
    - **Property 9: Task Queue Sorting by Priority Score**
    - **Property 10: Task Queue Tiebreaker by Deadline**
    - **Property 11: Manual Position Override Updates Task Record**
    - Generate random task arrays with varying priority scores and positions
    - Assert correct sorting order: position ASC (nulls last), priorityScore DESC, deadline ASC
    - _Requirements: 4.2, 4.3, 5.1_


- [x] 3. Implement ClassRoom and crowdsourcing features
  - [x] 3.1 Implement ClassRoom Service with Many-to-Many architecture
    - Create `src/lib/services/classroom.service.ts`
    - Implement `generateClassCode` using nanoid with custom alphabet (exclude 0O, 1Il), 8 characters
    - Implement `createClassRoom` with code collision retry logic (max 5 attempts)
    - Implement `joinClassRoom` to create ClassRoomMember records
    - Implement `leaveClassRoom` to delete UserTaskProgress records for classroom tasks only
    - Implement `getUserClassRooms` to fetch user's classroom memberships
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [x]* 3.2 Write property tests for ClassRoom Service
    - **Property 15: Class Code Uniqueness Validation**
    - **Property 16: Valid Class Code Join Creates Membership**
    - **Property 17: Classroom Task Propagation to All Members**
    - Generate random classroom sizes (1-50 members)
    - Assert exactly N UserTaskProgress records created for N members
    - _Requirements: 8.2, 8.3, 8.7_
  
  - [x] 3.3 Implement Task Edit Propagation with audit trail
    - Extend Task Service with `propagateTaskUpdates` method
    - Create TaskEditLog records for each field change (oldValue, newValue, fieldName)
    - Update single shared Task record (no duplication due to M:N architecture)
    - Send in-app notifications to classroom members via notification system
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  
  - [x]* 3.4 Write property tests for Task Edit Propagation
    - **Property 18: Task Edit Propagation and Audit Logging**
    - Generate random task edits (deadline, taskWeight, title changes)
    - Assert TaskEditLog record creation with correct oldValue/newValue
    - Assert single Task update (not N duplicates)
    - _Requirements: 9.1, 9.2_
  
  - [x] 3.5 Implement Anonymous Feed with RSA-OAEP Encryption
    - Create `src/lib/services/feed.service.ts`
    - Implement RSA public/private key pair generation (store private key securely in Vault/HSM config)
    - Implement `encryptAuthorId` using `crypto.publicEncrypt` with `RSA_PKCS1_OAEP_PADDING`
    - Implement `createAnonymousPost` with mandatory tag validation and authorId encryption
    - Implement `getFeedPosts` with reverse chronological ordering and tag filtering
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8_
  
  - [x]* 3.6 Write property tests for Anonymous Feed
    - **Property 19: Post Submission Requires Tag Selection**
    - **Property 20: Feed Post Reverse Chronological Ordering**
    - Generate random posts with/without tags
    - Generate random post arrays with varying timestamps
    - Assert validation error for missing tags
    - Assert descending createdAt order
    - _Requirements: 10.1, 10.4, 10.10_


- [ ] 4. Implement Cooked Meter and Recovery Mode
  - [x] 4.1 Implement Cooked Meter Service with Parent Task filtering
    - Create `src/lib/services/cooked-meter.service.ts`
    - Implement `calculateCumulativeScore` summing JIT Priority_Score for Parent Tasks ONLY (isSubTask=false filter)
    - Filter tasks with deadline in next 7 days via UserTaskProgress relationship
    - Implement `determineTier` with score ranges: 0-2000=MAIN_CHARACTER, 2001-5000=LET_HIM_COOK, 5001-8000=SLIGHTLY_COOKED, 8000+=OVERCOOKED
    - Implement `getSparklineData` fetching CookedScore records for last 7 days
    - Implement `saveDailySnapshot` creating CookedScore record with composite unique [userId, date]
    - Implement `shouldOfferRecoveryMode` checking if cumulativeScore > 8000
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 7.1_
  
  - [x]* 4.2 Write property tests for Cooked Meter Service
    - **Property 12: Cooked Tier Classification by Score Range**
    - Generate random cumulative scores (0-15000)
    - Assert correct tier mapping for each score range
    - Test boundary values: 2000, 2001, 5000, 5001, 8000, 8001
    - _Requirements: 6.3, 6.4, 6.5, 6.6_
  
  - [x] 4.3 Implement Recovery Mode Service with user consent
    - Create `src/lib/services/recovery-mode.service.ts`
    - Implement `getCandidateTasksForRecovery` identifying top 3 Parent Tasks with taskWeight > 3000 and isSubTask=false
    - Implement `activateRecoveryMode` with explicit taskIdsToBreakdown parameter (user consent required)
    - Implement `breakdownTask` creating 3-5 SubTasks with isSubTask=true flag
    - Space SubTask deadlines 1-2 days apart with proportional taskWeight distribution
    - Set parentTaskId linking SubTasks back to Parent Task
    - Implement `checkParentCompletion` to auto-complete Parent Task when all SubTasks done
    - Implement `getMotivationalText` fetching random Gen Z friendly message
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8_
  
  - [x]* 4.4 Write property tests for Recovery Mode
    - **Property 13: Recovery Mode Activation Threshold**
    - **Property 14: Task Breakdown Creates Micro-Tasks with Staggered Deadlines**
    - Generate random cumulative scores around 8000 threshold
    - Generate random high-weight tasks for breakdown
    - Assert activation offer triggered at score > 8000
    - Assert 3-5 SubTasks created with deadlines spaced 1-2 days apart
    - Assert sum of SubTask weights equals Parent Task weight
    - _Requirements: 7.1, 7.6_


- [x] 5. Implement viral social features
  - [x] 5.1 Implement Academic Wrapped Service with weekly card generation
    - Create `src/lib/services/academic-wrapped.service.ts`
    - Implement `calculateWeekStats` summing taskWeight for COMPLETED tasks in week range
    - Calculate streak: consecutive days with ≥1 completed task
    - Calculate highest tier reached during week from CookedScore records
    - Implement `saveWrappedRecord` creating AcademicWrapped database record
    - _Requirements: 11.1, 11.2, 11.10_
  
  - [x] 5.2 Write property tests for Academic Wrapped
    - **Property 21: Weekly Saved Credits Calculation**
    - Generate random task completion data across week boundaries
    - Assert correct sum of taskWeight for tasks completed within week range
    - Assert tasks outside week range excluded
    - _Requirements: 11.2_
  
  - [x] 5.3 Implement Academic Comeback celebration system
    - Extend Task Service `completeTask` to detect if task in OVERCOOKED tier
    - Calculate stress drop: cumulativeScore_before - cumulativeScore_after
    - Return celebration trigger flag and stress drop value
    - Create celebration context with oldTier, newTier, stressDrop for UI modal
    - _Requirements: 12.1, 12.5, 12.6_
  
  - [x] 5.4 Write property tests for Academic Comeback
    - **Property 22: Academic Comeback Celebration Trigger**
    - Generate tasks with cumulativeScore scenarios around OVERCOOKED threshold
    - Assert celebration triggered when completing OVERCOOKED task
    - Assert celebration not triggered for lower tier completions
    - _Requirements: 12.1_


- [x] 6. Implement Daily Digest with idempotent delivery
  - [x] 6.1 Implement Daily Digest Service with exactly-once semantics
    - Create `src/lib/services/daily-digest.service.ts`
    - Implement `generateDigestMessage` including: pending Parent Task count (isSubTask=false), top 3 by JIT Priority_Score, recent changes
    - Implement `getRecentChanges` fetching Parent Tasks added/changed in last 24 hours
    - Include deadline changes from TaskEditLog and priority escalations (timeUrgency delta > 1000)
    - Implement `attemptIdempotentDelivery` with database-first INSERT strategy
    - Insert DailyDigestLog with composite unique [userId, digestDate] BEFORE external API call
    - If constraint violation, fail-fast immediately (already sent today)
    - If INSERT succeeds, proceed with WhatsApp/Telegram API call
    - Implement `shouldSendDigest` checking current time against user digestTime ± 15 min window
    - _Requirements: 13.1, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_
  
  - [x] 6.2 Implement WhatsApp and Telegram integration with retry
    - Implement `sendViaWhatsApp` using Twilio/Fonnte/WhatsApp Business API
    - Implement `sendViaTelegram` using Telegram Bot API
    - Wrap both with exponential backoff retry mechanism (max 3 attempts, base delay 1000ms)
    - Log deliveryStatus (SENT, FAILED) to DailyDigestLog
    - Capture errorMessage on failure for debugging
    - _Requirements: 13.10_
  
  - [x]* 6.3 Write property tests for Daily Digest
    - **Property 23: Daily Digest Task Filtering**
    - Generate random task arrays with varying deadlines and completion status
    - Assert only tasks with status ≠ COMPLETED AND deadlineAt ≤ (now + 3 days) included
    - Assert Parent Tasks only (isSubTask=false filter)
    - _Requirements: 13.8_


- [x] 7. Checkpoint - Core services complete
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 8. Implement internationalization (i18n) [SHIFTED EARLIER TO PREVENT UI REFACTORING]
  - [x] 8.1 Set up i18n directory structure and translation files
    - Create `src/i18n/locales/en.json` with English translations
    - Create `src/i18n/locales/id.json` with Indonesian translations
    - Define translation keys for all UI strings: auth pages, dashboard, ClassRoom, Feed, settings
    - _Requirements: 2.5_
  
  - [x] 8.2 Create i18n utility functions
    - Create `src/i18n/utils.ts`
    - Implement `getTranslation(locale, key)` function
    - Implement `formatDate(date, locale)` with locale-specific formatting (dd/MM/yyyy for ID, MM/dd/yyyy for EN)
    - Use `@formatjs/intl-localematcher` for locale detection
    - _Requirements: 2.5, 2.9_
  
  - [x] 8.3 Apply translations infrastructure template to routing
    - Ensure Next.js middleware or dynamic locale patterns can inject `locale` into layout context
    - Setup initial context providers if needed to transmit active translations down the tree
    - _Requirements: 2.3, 2.5_
  
  - [x]* 8.4 Write integration tests for i18n core core structure
    - Test dictionary loading correctness for both `en` and `id` locales
    - Test date formatting changes based on simulated locale input
    - _Requirements: 2.3, 2.9_


- [ ] 9. Build authentication and user management UI
  - [x] 9.1 Create authentication pages (Server Components)
    - Create `src/app/(auth)/login/page.tsx` with email/password form
    - Create `src/app/(auth)/register/page.tsx` with email/password/name form
    - Wrap all static typography and labels around `getTranslation` wrappers directly
    - Use Server Actions for form submission
    - Display validation errors inline with Zod schema validation
    - Implement session redirect logic after successful auth
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 2.5_
  
  - [x] 9.2 Create Server Actions for authentication
    - Create `src/app/(auth)/actions.ts`
    - Implement `registerAction` calling AuthService.register
    - Implement `loginAction` calling AuthService.login and setting session cookie
    - Implement `logoutAction` calling AuthService.logout and clearing cookie
    - Return ActionResult type with success/error states for client handling
    - _Requirements: 1.1, 1.3, 1.8_
  
  - [x] 9.3 Create locale switcher component (Client Component)
    - Create `src/components/LocaleSwitcher.tsx` with "use client" directive
    - Display current locale with flag/label icons
    - Implement locale toggle between EN and ID
    - Call Server Action to persist locale to database User record
    - Reload page with new locale without losing state
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.8_
  
  - [x] 9.4 Implement locale persistence Server Actions
    - Create `src/app/actions/locale.ts`
    - Implement `switchLocaleAction` updating User.locale field
    - Return updated locale value for client state sync
    - _Requirements: 2.2, 2.6_
  
  - [x]* 9.5 Write integration tests for authentication flow
    - Test complete flow: register → verify account → login → verify session
    - Test duplicate email rejection
    - Test invalid credentials rejection
    - Test locale switching and persistence across sessions
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.4_


- [ ] 10. Build main dashboard with Task Queue
  - [x] 10.1 Create dashboard layout (Server Component)
    - Create `src/app/dashboard/layout.tsx` with Bento Grid layout
    - Implement responsive grid: Desktop (4 columns), Tablet (2 columns), Mobile (1 column)
    - Add navigation with locale switcher, user profile, logout button
    - Apply Tailwind CSS 4 for styling
    - _Requirements: 14.1_
  
  - [x] 10.2 Create Task Queue Server Component for initial render
    - Create `src/app/dashboard/page.tsx` fetching initial task data server-side
    - Call TaskService.getUserTasks with JIT priority calculation and hybrid sorting
    - Render TaskQueueClient component with initialTasks prop
    - Display empty state with illustration when queue empty
    - _Requirements: 4.1, 4.2, 4.10_
  
  - [x] 10.3 Create Task Queue Client Component with drag-and-drop
    - Create `src/app/dashboard/components/TaskQueueClient.tsx` with "use client"
    - Install and configure `@dnd-kit/core` for drag-and-drop
    - Implement drag handlers with visual feedback (placeholder, elevated shadow)
    - Apply Framer Motion for smooth animations during drag
    - Implement optimistic UI update: update local state immediately on drop
    - Call Server Action to persist position change to UserTaskProgress.position
    - Rollback local state if Server Action fails
    - _Requirements: 5.1, 5.2, 5.3, 14.2, 14.3, 14.4_
  
  - [x] 10.4 Create Task Card component with micro-prompt
    - Create `src/app/dashboard/components/TaskCard.tsx`
    - Display title, description, deadline, status badge
    - Display micro-prompt via localization keys
    - Add "🔥 SLA BREACH" badge when deadline < 24h with red color
    - Add override indicator icon for tasks with non-NULL position
    - Add "Shared from Class" indicator for tasks with classRoomId
    - Display nested SubTasks inside parent Task card (isSubTask=false renders parent, isSubTask=true nested)
    - _Requirements: 4.4, 4.5, 4.6, 4.8, 5.10, 8.9, 14.6_
  
  - [x] 10.5 Create Override Feedback Modal (Client Component)
    - Create `src/app/dashboard/components/OverrideModal.tsx` as bottom-sheet
    - Trigger modal automatically on task drop event
    - Display localized question: "Kenapa kamu memindahkan tugas ini ke atas?"
    - Provide 4 quick feedback options + "Alasan pribadi" with custom text input
    - Call Server Action to save TaskOverride record with reason
    - _Requirements: 5.4, 5.5, 5.6, 5.7_
  
  - [x] 10.6 Implement task completion flow with celebration trigger
    - Add complete button to TaskCard
    - Implement optimistic UI: mark task as COMPLETED immediately
    - Call Server Action completeTaskAction
    - Check triggerCelebration flag in response
    - Open AcademicComebackModal if celebration triggered
    - Update Cooked Meter widget after completion
    - _Requirements: 4.9, 12.1_
  
  - [x]* 10.7 Write integration tests for Task Queue UI
    - Test drag-and-drop position change with optimistic update
    - Test rollback on Server Action failure
    - Test override modal display and reason submission
    - Test task completion with Cooked Meter update
    - _Requirements: 4.9, 5.1, 5.3, 5.4, 14.2, 14.3, 14.4_


- [ ] 11. Build Cooked Meter widget and Recovery Mode UI
  - [x] 11.1 Create Cooked Meter Client Component with real-time updates
    - Create `src/app/dashboard/components/CookedMeter.tsx` with "use client"
    - Display progress bar or radial chart using Recharts
    - Apply tier-based colors: MAIN_CHARACTER=pastel green, LET_HIM_COOK=yellow, SLIGHTLY_COOKED=orange, OVERCOOKED=red
    - Add glitch effect animation for OVERCOOKED tier using GSAP
    - Display current cumulativeScore and tier label
    - Implement real-time updates via React state when tasks completed/added
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.10_
  
  - [x] 11.2 Add 7-day sparkline visualization to Cooked Meter
    - Fetch CookedScore records for last 7 days
    - Render sparkline mini-graph showing daily cumulativeScore trend
    - Use Recharts LineChart with minimal styling
    - Apply tier-based color gradient to sparkline
    - _Requirements: 6.7, 6.8_
  
  - [x] 11.3 Create Recovery Mode offer modal (Client Component)
    - Create `src/app/dashboard/components/RecoveryModeModal.tsx`
    - Trigger modal display when cumulativeScore > 8000 (from Cooked Meter check)
    - Display message: "Beban tugasmu tinggi. Aktifkan Recovery Mode untuk breakdown tugas kompleks?"
    - Show candidate Parent Tasks (top 3 with taskWeight > 3000)
    - Provide checkboxes for user to select which tasks to break down
    - Add action buttons: "Aktifkan" and "Nanti Saja"
    - _Requirements: 7.1, 7.2, 7.3, 14.3.1_
  
  - [x] 11.4 Implement Recovery Mode activation Server Action
    - Create `src/app/actions/recovery.ts`
    - Implement `activateRecoveryModeAction` receiving array of taskIdsToBreakdown
    - Call RecoveryModeService.activateRecoveryMode with user consent
    - Return breakdown results with created SubTasks
    - Display motivational text in success response
    - _Requirements: 7.2, 7.3, 7.9, 14.3.2, 14.3.3_
  
  - [x] 11.5 Update Cooked Meter to exclude SubTasks from stress calculation
    - Modify CookedMeterService.calculateCumulativeScore to filter isSubTask=false
    - Ensure only Parent Task priorityScores summed
    - Update frontend to display correct cumulative score after Recovery Mode activation
    - _Requirements: 7.8, 14.3.4_
  
  - [x]* 11.6 Write integration tests for Recovery Mode
    - Test modal display when cumulativeScore > 8000
    - Test modal dismissal on "Nanti Saja"
    - Test task breakdown with user selection
    - Test SubTask creation with staggered deadlines
    - Test Cooked Meter recalculation excluding SubTasks
    - _Requirements: 7.1, 7.2, 7.3, 7.8, 14.3.1, 14.3.2_


- [ ] 12. Build ClassRoom features
  - [x] 12.1 Create ClassRoom list page (Server Component)
    - Create `src/app/classrooms/page.tsx`
    - Fetch user's classroom memberships server-side via ClassRoomService.getUserClassRooms
    - Display classroom cards with name, classCode, member count, join date
    - Add "Create Class" and "Join Class" buttons
    - _Requirements: 8.6_
  
  - [x] 12.2 Create ClassRoom creation form (Client Component)
    - Create `src/app/classrooms/components/CreateClassForm.tsx`
    - Input fields: className, sksWeight (1-5 dropdown)
    - Call Server Action to create classroom
    - Display generated classCode prominently for sharing
    - _Requirements: 8.1, 8.3_
  
  - [x] 12.3 Create ClassRoom join form (Client Component)
    - Create `src/app/classrooms/components/JoinClassForm.tsx`
    - Input field: classCode (8-character validation)
    - Call Server Action to join classroom
    - Display success message or error if code invalid
    - _Requirements: 8.4, 8.5_
  
  - [x] 12.4 Implement ClassRoom Server Actions
    - Create `src/app/actions/classroom.ts`
    - Implement `createClassRoomAction` calling ClassRoomService.createClassRoom
    - Implement `joinClassRoomAction` calling ClassRoomService.joinClassRoom
    - Implement `leaveClassRoomAction` deleting UserTaskProgress records for classroom tasks
    - _Requirements: 8.1, 8.4, 8.5, 8.10_
  
  - [x] 12.5 Create ClassRoom detail page with member list
    - Create `src/app/classrooms/[id]/page.tsx`
    - Fetch classroom details and member list server-side
    - Display classroom name, sksWeight, member count
    - List all members (anonymized if user not ADMIN)
    - Add "Leave Class" button
    - Link to classroom feed
    - _Requirements: 8.6_
  
  - [x] 12.6 Implement task creation with classroom propagation
    - Extend task creation form with optional classRoomId field
    - When classRoomId selected, call TaskService.createTask with classRoomId
    - System automatically creates UserTaskProgress records for all classroom members
    - Display "Task shared to class" confirmation
    - _Requirements: 8.6, 8.7, 8.8_
  
  - [x]* 12.7 Write integration tests for ClassRoom features
    - Test complete flow: create classroom → join classroom → create shared task
    - Test class code uniqueness validation
    - Test UserTaskProgress propagation to all members
    - Test leave classroom deletes only UserTaskProgress, not Task
    - _Requirements: 8.1, 8.2, 8.7, 8.8, 8.10_


- [ ] 13. Build Task Edit History and notification system
  - [x] 13.1 Create Task Edit History UI component
    - Create `src/app/dashboard/components/TaskEditHistory.tsx`
    - Display collapsible timeline of TaskEditLog records
    - Show old vs new value comparison side-by-side
    - Display relative timestamps ("2 hours ago", "yesterday")
    - Show editor name and field changed
    - _Requirements: 9.4, 9.5, 9.6_
  
  - [x] 13.2 Add "Ada Update" badge to Task cards
    - Query unread TaskEditLog count per task for current user
    - Display badge with count on Task card if unread changes exist
    - Mark logs as read when user opens edit history timeline
    - _Requirements: 9.7, 9.9_
  
  - [x] 13.3 Implement in-app notification system
    - Create notification toast component using Framer Motion
    - Send notifications to all classroom members when task updated
    - Display message: "Task [title] diupdate oleh [creator name]"
    - Include link to view edit history
    - _Requirements: 9.5_
  
  - [x]* 13.4 Write integration tests for edit history
    - Test TaskEditLog creation on task field changes
    - Test audit trail display with oldValue/newValue
    - Test unread badge count
    - Test mark as read functionality
    - _Requirements: 9.1, 9.2, 9.6, 9.7, 9.9_


- [x] 14. Checkpoint - Dashboard and ClassRoom features complete
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 15. Build Anonymous ClassRoom Feed
  - [x] 15.1 Create Feed page (Server Component)
    - Create `src/app/classrooms/[id]/feed/page.tsx`
    - Fetch posts server-side via FeedService.getFeedPosts
    - Display posts in reverse chronological order
    - Show tag filter buttons for each PostTag category
    - Add "Create Post" button
    - _Requirements: 10.1, 10.9_
  
  - [x] 15.2 Create Anonymous Post form (Client Component)
    - Create `src/app/classrooms/[id]/feed/components/CreatePostForm.tsx`
    - Input textarea with 500 character limit
    - Mandatory PostTag dropdown: #CurhatTugas, #ButuhTemanTim, #TanyaJawaban, #DiskusiUmum
    - Display character count
    - Call Server Action to create post
    - _Requirements: 10.3, 10.4, 10.10_
  
  - [x] 15.3 Create Feed Post card component
    - Create `src/app/classrooms/[id]/feed/components/FeedPost.tsx`
    - Display anonymous avatar placeholder (no user info)
    - Display content (max 500 chars)
    - Display colored PostTag badge: #CurhatTugas=red, #ButuhTemanTim=blue, #TanyaJawaban=green, #DiskusiUmum=gray
    - Display relative timestamp
    - _Requirements: 10.2, 10.8_
  
  - [x] 15.4 Implement Feed Server Actions with encryption
    - Create `src/app/actions/feed.ts`
    - Implement `createAnonymousPostAction` calling FeedService.createAnonymousPost
    - Validate mandatory PostTag presence (reject if missing)
    - Encrypt authorId before database save using crypto.publicEncrypt
    - Return success or validation error
    - _Requirements: 10.1, 10.4, 10.5, 10.6_
  
  - [x] 15.5 Implement post tag filtering
    - Add filter buttons to Feed page
    - Call Server Action to fetch filtered posts by selected tag
    - Update post list without full page refresh
    - _Requirements: 10.9_
  
  - [x]* 15.6 Write integration tests for Anonymous Feed
    - Test post creation with mandatory tag validation
    - Test authorId encryption at rest
    - Test reverse chronological ordering
    - Test tag filtering functionality
    - Test 500 character limit enforcement
    - _Requirements: 10.1, 10.3, 10.4, 10.6, 10.10_


- [ ] 16. Build Academic Comeback celebration
  - [x] 16.1 Create Academic Comeback modal (Client Component)
    - Create `src/app/dashboard/components/AcademicComebackModal.tsx`
    - Implement fullscreen overlay with backdrop blur and high z-index
    - Display animated text "THE ACADEMIC COMEBACK IS REAL!" using GSAP TextPlugin with bounce effect
    - Add confetti animation using canvas-confetti library (3s duration, 200+ particles)
    - Display animated vertical bar chart showing stress drop using Recharts or Framer Motion
    - Chart animation: 1.5s duration with easeOutExpo easing
    - Display old tier → new tier transition
    - Add optional celebratory sound effect (if user enabled sound in settings, 50% volume)
    - Add "Share My Comeback" CTA button
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_
  
  - [x] 16.2 Integrate celebration trigger in task completion flow
    - Extend completeTaskAction to check if task in OVERCOOKED tier
    - Calculate stress drop from before/after cumulative scores
    - Return triggerCelebration flag and stressDrop value
    - Open AcademicComebackModal with oldTier, newTier, stressDrop props
    - Update Cooked Meter with animated transition after modal close
    - _Requirements: 12.1, 12.5, 12.10_
  
  - [x] 16.3 Add social share integration to celebration modal
    - Implement "Share My Comeback" button click handler
    - Generate temporary Academic Wrapped card snapshot with celebration context
    - Trigger Web Share API (mobile) or download button (desktop)
    - _Requirements: 12.9_
  
  - [x]* 16.4 Write integration tests for Academic Comeback
    - Test celebration trigger only for OVERCOOKED task completions
    - Test stress drop calculation accuracy
    - Test modal display and animations
    - Test Cooked Meter update after modal close
    - _Requirements: 12.1, 12.5, 12.10_


- [ ] 17. Build Academic Wrapped weekly card system
  - [x] 17.1 Create Academic Wrapped image generation service [MANDATED @VERCEL/OG]
    - Implement PNG generation in `AcademicWrappedService.renderCard` using pure `@vercel/og` (Satori)
    - **CRITICAL**: Do NOT use `node-canvas` to avoid serverless native binary compilation issues in Lambda/Vercel functions.
    - Set dimensions to 1080x1920 (9:16 vertical aspect ratio for mobile stories)
    - Apply modern gradient background (Gen Z premium palette)
    - Use Poppins/Inter fonts, display key weekly statistics, custom watermark, and deep link QR code.
    - _Requirements: 11.3, 11.4, 11.5, 11.6_
  
  - [x] 17.2 Implement CDN upload integration
    - Configure Vercel Blob or Cloudinary for image storage
    - Implement `AcademicWrappedService.uploadToCDN` to upload the generated PNG buffer
    - Return public URL for cloud sharing storage
    - _Requirements: 11.7_
  
  - [x] 17.3 Create weekly cron job with background queue/worker [TIMEOUT PREVENTION]
    - Create `src/app/api/webhooks/cron/route.ts`
    - Configure Vercel Cron to run every Sunday at 21:00 local time
    - **CRITICAL**: To avoid Serverless Execution Timeouts, do NOT evaluate and loop through all database users sequentially in a single synchronous thread. Instead, offload the processing payload into a background queue/worker engine (e.g., **Inngest** or **Upstash QStash**) to trigger distributed, parallel chunk processing.
    - Save AcademicWrapped record with imageUrl
    - Send in-app notification with preview thumbnail and "Share to Story" CTA
    - _Requirements: 11.1, 11.8_
  
  - [x] 17.4 Create Wrapped card preview and share UI
    - Create `src/app/dashboard/wrapped/page.tsx` displaying user's past wrapped cards
    - Show thumbnail gallery with week dates
    - Add "Share to Story" button triggering Web Share API
    - Fallback to download button on desktop
    - _Requirements: 11.9_
  
  - [x]* 17.5 Write integration tests for Academic Wrapped
    - Test week stats calculation (saved credits sum, tasks completed, streak)
    - Test PNG generation with correct dimensions (1080x1920)
    - Test CDN upload and URL return
    - Test cron job execution and worker distribution pipeline
    - _Requirements: 11.1, 11.2, 11.3, 11.4_


- [ ] 18. Build Daily Digest system
  - [x] 18.1 Create user settings page for digest preferences
    - Create `src/app/settings/page.tsx`
    - Add toggle switch for digestEnabled
    - Add time picker for digestTime (HH:MM format)
    - Add dropdown for deliveryChannel (WHATSAPP, TELEGRAM)
    - Save preferences to User record via Server Action
    - _Requirements: 13.1, 13.2_
  
  - [x] 18.2 Create digest cron job with background queue worker [TIMEOUT PREVENTION]
    - Create digest route handler in `src/app/api/webhooks/cron/route.ts`
    - Configure Vercel Cron to run every 30 minutes
    - Query users with digestEnabled=true and digestTime matching current time ± 15 min
    - **CRITICAL**: Offload the messaging delivery pipeline of each matching user to a background worker queue (**Inngest** or **QStash**) to run parallel async execution batches, mitigating Vercel serverless execution limits.
    - Log execution results (success/failure) to DailyDigestLog
    - _Requirements: 13.3, 13.4, 13.5, 13.6_
  
  - [x] 18.3 Implement digest message generation
    - Extend DailyDigestService.generateDigestMessage
    - Include: pending Parent Task count (isSubTask=false filter)
    - List top 3 tasks by JIT Priority_Score
    - Add "What changed since yesterday?" section with new tasks, deadline changes, priority escalations
    - Support both EN and ID locales via early shifted translation logic
    - _Requirements: 13.8, 13.9_
  
  - [x] 18.4 Configure WhatsApp Business API integration
    - Set up Twilio/Fonnte/WhatsApp Business API credentials in environment variables
    - Implement DailyDigestService.sendViaWhatsApp
    - Wrap with exponential backoff retry (max 3 attempts)
    - Return success/error status
    - _Requirements: 13.10_
  
  - [x] 18.5 Configure Telegram Bot API integration
    - Set up Telegram Bot API token in environment variables
    - Implement DailyDigestService.sendViaTelegram
    - Wrap with exponential backoff retry (max 3 attempts)
    - Return success/error status
    - _Requirements: 13.10_
  
  - [x] 18.6 Add user phone/chatId linking UI
    - Extend settings page with WhatsApp phone number input field
    - Add Telegram chat linking flow (display bot username, verify connection)
    - Save phone number and Telegram chatId to User record
    - _Requirements: 13.2_
  
  - [x]* 18.7 Write integration tests for Daily Digest
    - Test idempotency: duplicate digest attempts on same day fail
    - Test digest generation with correct task filtering (Parent Tasks only, deadline ≤ 3 days)
    - Test recent changes detection (new tasks, deadline shifts, priority escalations)
    - Test retry logic on external API failure
    - _Requirements: 13.5, 13.6, 13.8, 13.9, 13.10_


- [x] 19. Checkpoint - Viral features and automation complete
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 20. Polish UI/UX with animations and styling
  - [x] 20.1 Implement GSAP animations for smooth scrolling and hover effects
    - Install and configure GSAP 3.15.0
    - Add smooth scroll behavior to task queue
    - Add hover animations to task cards (scale, shadow)
    - Add page transition animations
    - _Requirements: 14.2, 14.6_
  
  - [x] 20.2 Implement Framer Motion micro-animations
    - Add entrance animations to modals and dialogs
    - Add exit animations with fade/scale effects
    - Add stagger animations to task list rendering
    - Add loading skeleton animations
    - _Requirements: 5.2, 14.2_
  
  - [x] 20.3 Apply Tailwind CSS 4 design system
    - Configure custom color palette for tier colors (pastel green, yellow, orange, red)
    - Set up typography scale using Inter/Poppins fonts
    - Apply responsive breakpoints for mobile/tablet/desktop
    - _Requirements: 14.1_
  
  - [x] 20.4 Implement error boundaries and loading states
    - Create global error boundary component
    - Add suspense boundaries with loading skeletons
    - Create toast notification system for errors/success messages
    - Add retry buttons for failed operations
    - _Requirements: Design: Error Handling_
  
  - [x]* 20.5 Write visual regression tests
    - Test component rendering across breakpoints
    - Test animation states (before, during, after)
    - Test color contrast for accessibility
    - _Requirements: 14.1, 14.2_


- [ ] 21. Performance optimization and production readiness
  - [ ] 21.1 Optimize database queries with indexes
    - Verify all Prisma indexes are created: classRoomId, creatorId, deadlineAt, parentTaskId
    - Add composite indexes for common query patterns: [userId, status], [userId, digestDate]
    - Run EXPLAIN ANALYZE on critical queries (task queue, cooked meter calculation)
    - _Requirements: Design: Data Models_
  
  - [ ] 21.2 Implement caching strategy
    - Add React Server Component caching for static data (classroom lists)
    - Implement SWR or React Query for client-side data fetching
    - Cache JIT priority calculations for 1 minute to reduce CPU load
    - Cache Academic Wrapped cards in CDN with long TTL
    - _Requirements: Performance_
  
  - [ ] 21.3 Configure production environment variables
    - Set up Neon PostgreSQL production connection string
    - Configure Auth.js secret and callback URLs
    - Configure WhatsApp/Telegram API credentials
    - Configure CDN upload credentials (Vercel Blob/Cloudinary)
    - Set up encryption keys for AnonymousPost authorId (store private key in HSM/vault)
    - _Requirements: 1.5, 10.6, 11.7, 13.2_
  
  - [ ] 21.4 Set up monitoring and error tracking
    - Integrate Sentry or similar error tracking service
    - Add custom error logging for external API failures
    - Set up performance monitoring for slow queries
    - Add uptime monitoring for cron jobs
    - _Requirements: Design: Error Handling_
  
  - [ ]* 21.5 Write performance tests
    - Test task queue rendering with 1000+ tasks
    - Test JIT priority calculation performance
    - Test database query performance with large datasets
    - Test concurrent user operations (optimistic UI, race conditions)
    - _Requirements: Performance_


- [ ] 22. Final integration and end-to-end testing
  - [ ] 22.1 Set up Playwright for E2E testing
    - Install and configure Playwright
    - Create test fixtures for authenticated sessions
    - Set up test database seeding and cleanup
    - _Requirements: Design: Testing Strategy_
  
  - [ ]* 22.2 Write E2E test for complete task management flow
    - Test: Register → Login → Create Task → View Queue → Complete Task → Verify Academic Comeback
    - Assert task appears in queue with correct priority order
    - Assert completion triggers celebration if OVERCOOKED tier
    - Assert Cooked Meter updates after completion
    - _Requirements: 1.1, 1.3, 4.1, 4.9, 12.1_
  
  - [ ]* 22.3 Write E2E test for classroom collaboration flow
    - Test: User A creates classroom → User B joins → User A creates task → Verify task appears in User B's queue
    - Assert UserTaskProgress records created for all members
    - Assert task edit propagation to all members
    - Assert leave classroom deletes only UserTaskProgress, not Task
    - _Requirements: 8.1, 8.4, 8.7, 9.1, 9.2_
  
  - [ ]* 22.4 Write E2E test for Recovery Mode flow
    - Test: Create 10 high-weight tasks → Verify Cooked Meter shows OVERCOOKED → Verify Recovery Mode modal appears → Activate → Verify SubTasks created
    - Assert SubTasks have staggered deadlines 1-2 days apart
    - Assert cumulative score recalculated excluding SubTasks
    - Assert Parent Task auto-completed when all SubTasks done
    - _Requirements: 7.1, 7.2, 7.6, 7.8, 7.9_
  
  - [ ]* 22.5 Write E2E test for locale switching persistence
    - Test: Login → Switch to Bahasa Indonesia → Verify UI text changes → Logout → Login → Verify locale persisted
    - Assert all UI strings use correct locale
    - Assert date formatting matches locale
    - _Requirements: 2.2, 2.3, 2.4, 2.7_


- [ ] 23. Final checkpoint and deployment preparation
  - Ensure all tests pass, ask the user if questions arise.
  - Verify production environment configuration
  - Run final security audit (check encrypted fields, session security, input validation)
  - Document API endpoints and deployment procedures


## Notes

- Tasks marked with `*` are optional testing tasks and can be skipped for faster MVP delivery
- Each implementation task references specific requirements for full traceability
- Property-based tests validate universal correctness properties from design document
- Integration and E2E tests validate critical user flows and system behavior
- Checkpoints ensure incremental validation and allow for user feedback
- All database operations use Prisma 7.8.0 with AsyncLocalStorage-based multi-tenant isolation
- Just-In-Time priority evaluation eliminates background cron jobs for Priority_Score calculation
- Many-to-Many task sharing via UserTaskProgress bridge table prevents task duplication
- Idempotent Daily Digest delivery via composite unique index [userId, digestDate]
- Anonymous Feed with RSA-OAEP encrypted authorId (decryption keys stored offline in HSM/vault)
- Recovery Mode requires explicit user consent before task breakdown
- SubTasks excluded from Cooked Meter cumulative score calculation (isSubTask=false filter)

### Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "1.4"]
    },
    {
      "id": 1,
      "tasks": ["1.2", "1.3"]
    },
    {
      "id": 2,
      "tasks": ["1.5", "2.1"]
    },
    {
      "id": 3,
      "tasks": ["2.2", "2.4"]
    },
    {
      "id": 4,
      "tasks": ["2.3", "2.5", "2.6"]
    },
    {
      "id": 5,
      "tasks": ["2.7", "3.1"]
    },
    {
      "id": 6,
      "tasks": ["3.2", "3.3", "3.5"]
    },
    {
      "id": 7,
      "tasks": ["3.4", "3.6", "4.1"]
    },
    {
      "id": 8,
      "tasks": ["4.2", "4.3"]
    },
    {
      "id": 9,
      "tasks": ["4.4", "5.1"]
    },
    {
      "id": 10,
      "tasks": ["5.2", "5.3"]
    },
    {
      "id": 11,
      "tasks": ["5.4", "6.1"]
    },
    {
      "id": 12,
      "tasks": ["6.2", "6.3"]
    },
    {
      "id": 13,
      "tasks": ["8.1", "8.2"]
    },
    {
      "id": 14,
      "tasks": ["8.3", "8.4"]
    },
    {
      "id": 15,
      "tasks": ["9.1", "9.2"]
    },
    {
      "id": 16,
      "tasks": ["9.3", "9.4"]
    },
    {
      "id": 17,
      "tasks": ["9.5", "10.1"]
    },
    {
      "id": 18,
      "tasks": ["10.2", "10.3"]
    },
    {
      "id": 19,
      "tasks": ["10.4", "10.5"]
    },
    {
      "id": 20,
      "tasks": ["10.6", "10.7"]
    },
    {
      "id": 21,
      "tasks": ["11.1", "11.2"]
    },
    {
      "id": 22,
      "tasks": ["11.3", "11.4"]
    },
    {
      "id": 23,
      "tasks": ["11.5", "11.6"]
    },
    {
      "id": 24,
      "tasks": ["12.1", "12.2", "12.3"]
    },
    {
      "id": 25,
      "tasks": ["12.4", "12.5"]
    },
    {
      "id": 26,
      "tasks": ["12.6", "12.7"]
    },
    {
      "id": 27,
      "tasks": ["13.1", "13.2"]
    },
    {
      "id": 28,
      "tasks": ["13.3", "13.4"]
    },
    {
      "id": 29,
      "tasks": ["15.1", "15.2"]
    },
    {
      "id": 30,
      "tasks": ["15.3", "15.4"]
    },
    {
      "id": 31,
      "tasks": ["15.5", "15.6"]
    },
    {
      "id": 32,
      "tasks": ["16.1", "16.2"]
    },
    {
      "id": 33,
      "tasks": ["16.3", "16.4"]
    },
    {
      "id": 34,
      "tasks": ["17.1", "17.2"]
    },
    {
      "id": 35,
      "tasks": ["17.3", "17.4"]
    },
    {
      "id": 36,
      "tasks": ["17.5", "18.1"]
    },
    {
      "id": 37,
      "tasks": ["18.2", "18.3"]
    },
    {
      "id": 38,
      "tasks": ["18.4", "18.5"]
    },
    {
      "id": 39,
      "tasks": ["18.6", "18.7"]
    },
    {
      "id": 40,
      "tasks": ["20.1", "20.2"]
    },
    {
      "id": 41,
      "tasks": ["20.3", "20.4"]
    },
    {
      "id": 42,
      "tasks": ["20.5", "21.1"]
    },
    {
      "id": 43,
      "tasks": ["21.2", "21.3"]
    },
    {
      "id": 44,
      "tasks": ["21.4", "21.5"]
    },
    {
      "id": 45,
      "tasks": ["22.1", "22.2"]
    },
    {
      "id": 46,
      "tasks": ["22.3", "22.4", "22.5"]
    }
  ]
}
