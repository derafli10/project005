/**
 * Pure in-memory data store for service-layer property tests.
 *
 * Reset between tests via {@link resetInMemoryDb}.
 */

export interface InMemoryUser {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  role: "ADMIN" | "MEMBER";
  locale: "EN" | "ID";
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemorySession {
  id: string;
  sessionToken: string;
  userId: string;
  expires: Date;
}

export interface InMemoryTask {
  id: string;
  title: string;
  description: string | null;
  sksWeight: number;
  taskWeight: number;
  deadlineAt: Date;
  isSubTask: boolean;
  parentTaskId: string | null;
  classRoomId: string | null;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryUserTaskProgress {
  userId: string;
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  position: number | null;
  completedAt: Date | null;
  currentStressScore: number;
}

export interface InMemoryTaskOverride {
  id: string;
  userId: string;
  taskId: string;
  reason: string;
  overriddenAt: Date;
}

export interface InMemoryTaskEditLog {
  id: string;
  taskId: string;
  editorId: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  editedAt: Date;
}

export interface InMemoryClassRoom {
  id: string;
  className: string;
  classCode: string;
  sksWeight: number;
  creatorId: string;
  createdAt: Date;
}

export interface InMemoryClassRoomMember {
  classRoomId: string;
  userId: string;
  joinedAt: Date;
}

export interface InMemoryAnonymousPost {
  id: string;
  classRoomId: string;
  encryptedAuthorId: string | null;
  content: string;
  tag: "CURHAT_TUGAS" | "BUTUH_TEMAN_TIM" | "TANYA_JAWABAN" | "DISKUSI_UMUM";
  createdAt: Date;
}

export interface InMemoryCookedScore {
  id: string;
  userId: string;
  date: Date;
  cumulativeScore: number;
  tier: "MAIN_CHARACTER" | "LET_HIM_COOK" | "SLIGHTLY_COOKED" | "OVERCOOKED";
  createdAt: Date;
}

export interface InMemoryAcademicWrapped {
  id: string;
  userId: string;
  weekStartDate: Date;
  weekEndDate: Date;
  totalSavedCredits: number;
  tasksCompleted: number;
  highestTier: "MAIN_CHARACTER" | "LET_HIM_COOK" | "SLIGHTLY_COOKED" | "OVERCOOKED";
  streak: number;
  imageUrl: string | null;
}

export interface InMemoryStore {
  users: Map<string, InMemoryUser>;
  usersByEmail: Map<string, string>; // email(lower) → userId
  sessions: Map<string, InMemorySession>; // sessionToken → session
  sessionsById: Map<string, string>; // id → sessionToken
  tasks: Map<string, InMemoryTask>;
  userTaskProgress: Map<string, InMemoryUserTaskProgress>; // `${userId}/${taskId}`
  taskOverrides: Map<string, InMemoryTaskOverride>;
  taskEditLogs: Map<string, InMemoryTaskEditLog>;
  classRooms: Map<string, InMemoryClassRoom>;
  classRoomsByCode: Map<string, string>; // classCode → id
  classRoomMembers: Map<string, InMemoryClassRoomMember>; // `${classRoomId}/${userId}`
  anonymousPosts: Map<string, InMemoryAnonymousPost>;
  cookedScores: Map<string, InMemoryCookedScore>; // `${userId}/${dateISO}` → score
  academicWrapped: Map<string, InMemoryAcademicWrapped>; // `${userId}/${weekStartDateISO}`
  counters: { user: number; session: number; task: number; override: number; editLog: number; anonymousPost: number; cookedScore: number; academicWrapped: number };
}

export function createInMemoryStore(): InMemoryStore {
  return {
    users: new Map(),
    usersByEmail: new Map(),
    sessions: new Map(),
    sessionsById: new Map(),
    tasks: new Map(),
    userTaskProgress: new Map(),
    taskOverrides: new Map(),
    taskEditLogs: new Map(),
    classRooms: new Map(),
    classRoomsByCode: new Map(),
    classRoomMembers: new Map(),
    anonymousPosts: new Map(),
    cookedScores: new Map(),
    academicWrapped: new Map(),
    counters: { user: 0, session: 0, task: 0, override: 0, editLog: 0, anonymousPost: 0, cookedScore: 0, academicWrapped: 0 },
  };
}

let _store = createInMemoryStore();

export function getInMemoryStore(): InMemoryStore {
  return _store;
}

export function resetInMemoryDb(): void {
  _store = createInMemoryStore();
}

// ─── ID generators ─────────────────────────────────────────────────────────

export function nextUserId(s: InMemoryStore): string {
  return `user_${++s.counters.user}`;
}
export function nextSessionId(s: InMemoryStore): string {
  return `sess_${++s.counters.session}`;
}
export function nextTaskId(s: InMemoryStore): string {
  return `task_${++s.counters.task}`;
}
export function nextOverrideId(s: InMemoryStore): string {
  return `ovr_${++s.counters.override}`;
}
export function nextEditLogId(s: InMemoryStore): string {
  return `log_${++s.counters.editLog}`;
}
export function nextAnonymousPostId(s: InMemoryStore): string {
  return `post_${++s.counters.anonymousPost}`;
}
export function nextCookedScoreId(s: InMemoryStore): string {
  return `cs_${++s.counters.cookedScore}`;
}
export function nextAcademicWrappedId(s: InMemoryStore): string {
  return `aw_${++s.counters.academicWrapped}`;
}
