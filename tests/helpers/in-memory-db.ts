/**
 * In-memory Prisma client mock for service-layer property tests.
 *
 * Provides just enough of the Prisma surface used by `auth.service.ts` and
 * `task.service.ts` to exercise their logic without a real database. The mock
 * is reset between tests via {@link resetInMemoryDb}.
 *
 * Both `db` and `baseDb` resolve to the same object — the in-memory store does
 * not enforce row-level security (the services under test already pass
 * explicit userId filters). `withUserContext` simply forwards its callback.
 */
import {
  createInMemoryStore,
  getInMemoryStore,
  nextUserId,
  nextSessionId,
  nextTaskId,
  nextOverrideId,
  nextEditLogId,
  nextAnonymousPostId,
  nextCookedScoreId,
  nextAcademicWrappedId,
  nextDailyDigestLogId,
  type InMemoryStore,
} from "./store";

export { createInMemoryStore, getInMemoryStore, resetInMemoryDb } from "./store";

// ─── helpers ───────────────────────────────────────────────────────────────

function selectProject<T extends Record<string, unknown>>(
  row: T,
  select: Record<string, boolean> | undefined
): T {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [key, include] of Object.entries(select)) {
    if (include && key in row) out[key] = row[key];
  }
  return out as T;
}

function userToRow(s: InMemoryStore, id: string) {
  const u = s.users.get(id);
  if (!u) return null;
  return { ...u };
}

// ─── mock factory ──────────────────────────────────────────────────────────

export function buildInMemoryClient() {
  const client = {
    user: {
      async findUnique(args: {
        where: { email?: string; id?: string };
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        let row = null as null | ReturnType<typeof userToRow>;
        if (args.where.email) {
          const id = s.usersByEmail.get(args.where.email.toLowerCase());
          row = id ? userToRow(s, id) : null;
        } else if (args.where.id) {
          row = userToRow(s, args.where.id);
        }
        if (!row) return null;
        return selectProject(row, args.select);
      },

      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const email = String(args.data.email).toLowerCase();
        if (s.usersByEmail.has(email)) {
          // Mimic Prisma unique-violation as a thrown object the service can
          // surface — but our service pre-checks, so this is a safety net.
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        const id = args.data.id ? String(args.data.id) : nextUserId(s);
        const now = new Date();
        const user = {
          id,
          email,
          name: (args.data.name as string | null) ?? null,
          passwordHash: (args.data.passwordHash as string | null) ?? null,
          role: (args.data.role as "ADMIN" | "MEMBER") ?? "MEMBER",
          locale: (args.data.locale as "EN" | "ID") ?? "EN",
          digestEnabled: (args.data.digestEnabled as boolean) ?? false,
          digestTime: (args.data.digestTime as string | null) ?? null,
          deliveryChannel: (args.data.deliveryChannel as "WHATSAPP" | "TELEGRAM") ?? "WHATSAPP",
          whatsappNumber: (args.data.whatsappNumber as string | null) ?? null,
          telegramChatId: (args.data.telegramChatId as string | null) ?? null,
          createdAt: now,
          updatedAt: now,
        };
        s.users.set(id, user);
        s.usersByEmail.set(email, id);
        return { ...user };
      },

      /**
       * Partial update of a User row (e.g. `switchLocaleAction` updating
       * `User.locale`). Mirrors Prisma's `user.update` semantics enough for
       * the auth-flow integration tests. Supports the `select` projection and
       * preserves the email index if the email ever changes.
       */
      async update(args: {
        where: { id: string };
        data: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        const existing = s.users.get(args.where.id);
        if (!existing) {
          throw Object.assign(new Error("User not found"), { code: "P2022" });
        }

        // Maintain the email index if the email changes.
        const newEmail = args.data.email;
        if (typeof newEmail === "string") {
          const normalized = newEmail.toLowerCase();
          if (normalized !== existing.email) {
            s.usersByEmail.delete(existing.email);
            args.data.email = normalized;
            s.usersByEmail.set(normalized, existing.id);
          }
        }

        const updated = {
          ...existing,
          ...args.data,
          updatedAt: new Date(),
        } as typeof existing;
        s.users.set(existing.id, updated);
        return selectProject({ ...updated }, args.select);
      },

      async findMany(args?: {
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        const out: any[] = [];
        for (const u of s.users.values()) {
          out.push(selectProject({ ...u }, args?.select));
        }
        return out;
      },
    },

    session: {
      async findUnique(args: {
        where: { sessionToken: string };
        include?: { user?: boolean };
      }) {
        const s = getInMemoryStore();
        const session = s.sessions.get(args.where.sessionToken);
        if (!session) return null;
        const result: Record<string, unknown> = { ...session };
        if (args.include?.user) {
          result.user = userToRow(s, session.userId);
        }
        return result;
      },

      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const sessionToken = String(args.data.sessionToken);
        const userId = String(args.data.userId);
        const expires =
          args.data.expires instanceof Date
            ? args.data.expires
            : new Date(args.data.expires as string);
        const id = nextSessionId(s);
        const session = { id, sessionToken, userId, expires };
        s.sessions.set(sessionToken, session);
        s.sessionsById.set(id, sessionToken);
        return { ...session };
      },

      async delete(args: { where: { id?: string; sessionToken?: string } }) {
        const s = getInMemoryStore();
        let token: string | undefined;
        if (args.where.sessionToken) token = args.where.sessionToken;
        else if (args.where.id) token = s.sessionsById.get(args.where.id);
        if (token) {
          const sess = s.sessions.get(token);
          s.sessions.delete(token);
          if (sess) s.sessionsById.delete(sess.id);
          return sess ? { ...sess } : null;
        }
        return null;
      },
    },

    task: {
      async findUnique(args: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        const t = s.tasks.get(args.where.id);
        if (!t) return null;
        return selectProject({ ...t }, args.select);
      },

      async findUniqueOrThrow(args: { where: { id: string } }) {
        const s = getInMemoryStore();
        const t = s.tasks.get(args.where.id);
        if (!t) throw new Error("Task not found");
        return { ...t };
      },

      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const id = args.data.id ? String(args.data.id) : nextTaskId(s);
        const now = new Date();
        const task = {
          id,
          title: String(args.data.title ?? ""),
          description: (args.data.description as string | null) ?? null,
          sksWeight: (args.data.sksWeight as number) ?? 3,
          taskWeight: (args.data.taskWeight as number) ?? 5000,
          deadlineAt:
            args.data.deadlineAt instanceof Date
              ? (args.data.deadlineAt as Date)
              : new Date(args.data.deadlineAt as string),
          isSubTask: (args.data.isSubTask as boolean) ?? false,
          parentTaskId: (args.data.parentTaskId as string | null) ?? null,
          classRoomId: (args.data.classRoomId as string | null) ?? null,
          creatorId: String(args.data.creatorId),
          createdAt: now,
          updatedAt: now,
        };
        s.tasks.set(id, task);
        return { ...task };
      },

      async update(args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        const s = getInMemoryStore();
        const existing = s.tasks.get(args.where.id);
        if (!existing) throw new Error("Task not found");
        const updated = { ...existing, ...args.data, updatedAt: new Date() } as typeof existing;
        s.tasks.set(args.where.id, updated);
        return { ...updated };
      },

      async findMany(args: {
        where?: {
          classRoomId?: string;
          parentTaskId?: string;
          creatorId?: string;
          isSubTask?: boolean;
        };
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        const out: Record<string, unknown>[] = [];
        for (const t of s.tasks.values()) {
          if (args.where?.classRoomId && t.classRoomId !== args.where.classRoomId) continue;
          if (args.where?.parentTaskId && t.parentTaskId !== args.where.parentTaskId) continue;
          if (args.where?.creatorId && t.creatorId !== args.where.creatorId) continue;
          if (args.where?.isSubTask !== undefined && t.isSubTask !== args.where.isSubTask) continue;
          out.push(selectProject({ ...t }, args.select));
        }
        return out;
      },
    },

    userTaskProgress: {
      async findUnique(args: {
        where: { userId_taskId: { userId: string; taskId: string } };
        include?: { task?: boolean };
      }) {
        const s = getInMemoryStore();
        const key = `${args.where.userId_taskId.userId}/${args.where.userId_taskId.taskId}`;
        const p = s.userTaskProgress.get(key);
        if (!p) return null;
        const result: Record<string, unknown> = { ...p };
        if (args.include?.task) {
          result.task = s.tasks.get(p.taskId) ?? null;
        }
        return result;
      },

      async findMany(args: {
        where: {
          userId?: string;
          status?: unknown;
          taskId?: string | { in?: string[] };
          task?: Record<string, unknown>;
          completedAt?: { gte?: Date; lte?: Date; gt?: Date; lt?: Date } | Date | null;
        };
        include?: { task?: boolean };
        select?: Record<string, boolean | { select?: Record<string, boolean> }>;
      }) {
        const s = getInMemoryStore();
        const userId = args.where?.userId as string | undefined;
        const statusFilter = args.where?.status as
          | { in?: string[] }
          | string
          | undefined;
        const taskIdFilter = args.where?.taskId as
          | string
          | { in?: string[] }
          | undefined;
        const completedAtFilter = args.where?.completedAt as
          | { gte?: Date; lte?: Date; gt?: Date; lt?: Date }
          | Date
          | null
          | undefined;
        const taskFilter = args.where?.task as
          | {
              isSubTask?: boolean;
              taskWeight?: { gt?: number; gte?: number; lt?: number; lte?: number };
              deadlineAt?: { gt?: Date; gte?: Date; lt?: Date; lte?: Date };
            }
          | undefined;
        const out: Record<string, unknown>[] = [];
        for (const p of s.userTaskProgress.values()) {
          if (userId && p.userId !== userId) {
            continue;
          }
          if (statusFilter) {
            if (typeof statusFilter === "string") {
              if (p.status !== statusFilter) {
                continue;
              }
            } else if (typeof statusFilter === "object" && "in" in statusFilter && statusFilter.in) {
              if (!statusFilter.in.includes(p.status)) {
                continue;
              }
            }
          }
          if (taskIdFilter) {
            if (typeof taskIdFilter === "string") {
              if (p.taskId !== taskIdFilter) continue;
            } else if (taskIdFilter.in && !taskIdFilter.in.includes(p.taskId)) continue;
          }
          if (completedAtFilter !== undefined) {
            if (completedAtFilter === null) {
              if (p.completedAt !== null) continue;
            } else if (completedAtFilter instanceof Date) {
              if (!p.completedAt || p.completedAt.getTime() !== completedAtFilter.getTime()) continue;
            } else {
              const cat = p.completedAt ? p.completedAt.getTime() : 0;
              if (!p.completedAt) continue;
              if (completedAtFilter.gte && cat < completedAtFilter.gte.getTime()) continue;
              if (completedAtFilter.lte && cat > completedAtFilter.lte.getTime()) continue;
              if (completedAtFilter.gt && cat <= completedAtFilter.gt.getTime()) continue;
              if (completedAtFilter.lt && cat >= completedAtFilter.lt.getTime()) continue;
            }
          }
          const taskRow = s.tasks.get(p.taskId);
          if (taskFilter && taskRow) {
            if (taskFilter.isSubTask !== undefined && taskRow.isSubTask !== taskFilter.isSubTask) {
              continue;
            }
            if (taskFilter.taskWeight) {
              if (taskFilter.taskWeight.gt !== undefined && !(taskRow.taskWeight > taskFilter.taskWeight.gt)) continue;
              if (taskFilter.taskWeight.gte !== undefined && !(taskRow.taskWeight >= taskFilter.taskWeight.gte)) continue;
              if (taskFilter.taskWeight.lt !== undefined && !(taskRow.taskWeight < taskFilter.taskWeight.lt)) continue;
              if (taskFilter.taskWeight.lte !== undefined && !(taskRow.taskWeight <= taskFilter.taskWeight.lte)) continue;
            }
            if (taskFilter.deadlineAt) {
              const t = taskRow.deadlineAt.getTime();
              if (taskFilter.deadlineAt.gt && !(t > taskFilter.deadlineAt.gt.getTime())) continue;
              if (taskFilter.deadlineAt.gte && !(t >= taskFilter.deadlineAt.gte.getTime())) continue;
              if (taskFilter.deadlineAt.lt && !(t < taskFilter.deadlineAt.lt.getTime())) continue;
              if (taskFilter.deadlineAt.lte && !(t <= taskFilter.deadlineAt.lte.getTime())) continue;
            }
          }
          const row: Record<string, unknown> = { ...p };
          if (args.include?.task) {
            row.task = taskRow ?? null;
          }
          if (args.select?.task && taskRow) {
            const sub = (args.select.task as { select?: Record<string, boolean> }).select;
            row.task = sub ? selectProject({ ...taskRow }, sub) : { ...taskRow };
          }
          out.push(row);
        }
        return out;
      },

      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const userId = String(args.data.userId);
        const taskId = String(args.data.taskId);
        const key = `${userId}/${taskId}`;
        if (s.userTaskProgress.has(key)) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        const progress = {
          userId,
          taskId,
          status: (args.data.status as "PENDING" | "IN_PROGRESS" | "COMPLETED") ?? "PENDING",
          position: (args.data.position as number | null) ?? null,
          completedAt: (args.data.completedAt as Date | null) ?? null,
          currentStressScore: (args.data.currentStressScore as number) ?? 0,
        };
        s.userTaskProgress.set(key, progress);
        return { ...progress };
      },

      async createMany(args: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) {
        const s = getInMemoryStore();
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        let count = 0;
        for (const d of rows) {
          const userId = String(d.userId);
          const taskId = String(d.taskId);
          const key = `${userId}/${taskId}`;
          if (s.userTaskProgress.has(key)) {
            if (args.skipDuplicates) continue;
            throw Object.assign(new Error("Unique constraint failed"), {
              code: "P2002",
            });
          }
          s.userTaskProgress.set(key, {
            userId,
            taskId,
            status: (d.status as "PENDING" | "IN_PROGRESS" | "COMPLETED") ?? "PENDING",
            position: (d.position as number | null) ?? null,
            completedAt: (d.completedAt as Date | null) ?? null,
            currentStressScore: (d.currentStressScore as number) ?? 0,
          });
          count++;
        }
        return { count };
      },

      async update(args: {
        where: { userId_taskId: { userId: string; taskId: string } };
        data: Record<string, unknown>;
      }) {
        const s = getInMemoryStore();
        const key = `${args.where.userId_taskId.userId}/${args.where.userId_taskId.taskId}`;
        const existing = s.userTaskProgress.get(key);
        if (!existing) throw new Error("UserTaskProgress not found");
        const updated = { ...existing, ...args.data } as typeof existing;
        s.userTaskProgress.set(key, updated);
        return { ...updated };
      },

      async deleteMany(args: {
        where: {
          userId: string;
          taskId: { in: string[] };
        };
      }) {
        const s = getInMemoryStore();
        const taskIds = args.where.taskId.in;
        let count = 0;
        for (const taskId of taskIds) {
          const key = `${args.where.userId}/${taskId}`;
          if (s.userTaskProgress.delete(key)) {
            count++;
          }
        }
        return { count };
      },

      async count(args: any) {
        const rows = await client.userTaskProgress.findMany(args);
        return rows.length;
      },
    },

    taskOverride: {
      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const id = nextOverrideId(s);
        const override = {
          id,
          userId: String(args.data.userId),
          taskId: String(args.data.taskId),
          reason: String(args.data.reason ?? ""),
          overriddenAt: new Date(),
        };
        s.taskOverrides.set(id, override);
        return { ...override };
      },
    },

    taskEditLog: {
      async createMany(args: { data: unknown }) {
        const s = getInMemoryStore();
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        for (const d of rows as Array<Record<string, unknown>>) {
          const id = nextEditLogId(s);
          s.taskEditLogs.set(id, {
            id,
            taskId: String(d.taskId),
            editorId: String(d.editorId),
            fieldName: String(d.fieldName),
            oldValue: String(d.oldValue ?? ""),
            newValue: String(d.newValue ?? ""),
            editedAt: new Date(),
          });
        }
        return { count: rows.length };
      },

      async findMany(args: {
        where?: {
          taskId?: string | { in?: string[] };
          editorId?: { not?: string };
          fieldName?: string;
          editedAt?: { gte?: Date };
          readStates?: {
            none?: {
              userId?: string;
              isRead?: boolean;
            };
          };
          task?: {
            isSubTask?: boolean;
            userProgress?: {
              some?: {
                userId?: string;
                status?: { in?: string[] };
              };
            };
          };
        };
        select?: Record<string, boolean>;
        include?: {
          editor?: { select?: { name?: boolean } };
          task?: { select?: { title?: boolean } };
        };
        orderBy?: { editedAt?: "asc" | "desc" };
      }) {
        const s = getInMemoryStore();
        const logs = Array.from(s.taskEditLogs.values());
        
        const filtered = logs.filter((log) => {
          // Handle taskId filter (string or { in: string[] })
          if (args.where?.taskId) {
            if (typeof args.where.taskId === "string") {
              if (log.taskId !== args.where.taskId) return false;
            } else if (args.where.taskId.in) {
              if (!args.where.taskId.in.includes(log.taskId)) return false;
            }
          }
          
          // Handle editorId.not filter
          if (args.where?.editorId?.not && log.editorId === args.where.editorId.not) {
            return false;
          }
          
          if (args.where?.fieldName && log.fieldName !== args.where.fieldName) {
            return false;
          }
          if (args.where?.editedAt?.gte && log.editedAt < args.where.editedAt.gte) {
            return false;
          }
          
          // Handle readStates.none filter (check that no read state exists with given conditions)
          if (args.where?.readStates?.none) {
            const { userId, isRead } = args.where.readStates.none;
            const readKey = `${log.id}/${userId}`;
            const readState = s.taskEditLogReads.get(readKey);
            
            // If a read state exists and matches the condition, exclude this log
            if (readState && readState.isRead === isRead) {
              return false;
            }
          }
          
          if (args.where?.task) {
            const task = s.tasks.get(log.taskId);
            if (!task) return false;
            
            if (args.where.task.isSubTask !== undefined && task.isSubTask !== args.where.task.isSubTask) {
              return false;
            }
            
            if (args.where.task.userProgress?.some) {
              const filterUserId = args.where.task.userProgress.some.userId;
              const filterStatusIn = args.where.task.userProgress.some.status?.in;
              
              const progressKey = `${filterUserId}/${task.id}`;
              const progress = s.userTaskProgress.get(progressKey);
              if (!progress) return false;
              
              if (filterStatusIn && !filterStatusIn.includes(progress.status)) {
                return false;
              }
            }
          }
          return true;
        });

        if (args.orderBy?.editedAt) {
          const dir = args.orderBy.editedAt === "asc" ? 1 : -1;
          filtered.sort((a, b) => (a.editedAt.getTime() - b.editedAt.getTime()) * dir);
        }

        return filtered.map((log) => {
          const result: any = { ...log };
          
          if (args.include?.editor) {
            const editor = s.users.get(log.editorId);
            result.editor = editor ? { name: editor.name } : { name: null };
          }
          
          if (args.include?.task) {
            const task = s.tasks.get(log.taskId);
            result.task = task ? { title: task.title } : { title: null };
          }
          
          if (args.select?.task) {
            const task = s.tasks.get(log.taskId);
            result.task = task ? { ...task } : null;
          }
          
          return result;
        });
      },
    },

    taskEditLogRead: {
      async createMany(args: { data: unknown; skipDuplicates?: boolean }) {
        const s = getInMemoryStore();
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        let created = 0;
        
        for (const d of rows as Array<Record<string, unknown>>) {
          const logId = String(d.logId);
          const userId = String(d.userId);
          const key = `${logId}/${userId}`;
          
          // Skip duplicates if requested
          if (args.skipDuplicates && s.taskEditLogReads.has(key)) {
            continue;
          }
          
          s.taskEditLogReads.set(key, {
            logId,
            userId,
            isRead: Boolean(d.isRead ?? true),
          });
          created++;
        }
        
        return { count: created };
      },

      async findMany(args: {
        where?: {
          logId?: { in?: string[] };
          userId?: string;
          isRead?: boolean;
        };
      }) {
        const s = getInMemoryStore();
        const reads = Array.from(s.taskEditLogReads.values());
        
        return reads.filter((read) => {
          if (args.where?.logId?.in && !args.where.logId.in.includes(read.logId)) {
            return false;
          }
          if (args.where?.userId && read.userId !== args.where.userId) {
            return false;
          }
          if (args.where?.isRead !== undefined && read.isRead !== args.where.isRead) {
            return false;
          }
          return true;
        });
      },
    },

    classRoom: {
      async findUnique(args: {
        where: { id?: string; classCode?: string };
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        let row = null as null | Record<string, unknown>;
        if (args.where.id) {
          const c = s.classRooms.get(args.where.id);
          row = c ? { ...c } : null;
        } else if (args.where.classCode) {
          const id = s.classRoomsByCode.get(args.where.classCode);
          const c = id ? s.classRooms.get(id) : null;
          row = c ? { ...c } : null;
        }
        if (!row) return null;
        return selectProject(row, args.select);
      },

      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const id = args.data.id ? String(args.data.id) : `cl${Math.random().toString(36).substring(2, 11).padEnd(22, "0")}`;
        const classRoom = {
          id,
          className: String(args.data.className),
          classCode: String(args.data.classCode),
          sksWeight: (args.data.sksWeight as number) ?? 3,
          creatorId: String(args.data.creatorId),
          createdAt: new Date(),
        };
        s.classRooms.set(id, classRoom);
        s.classRoomsByCode.set(classRoom.classCode, id);
        return { ...classRoom };
      },
    },

    classRoomMember: {
      async findUnique(args: {
        where: { classRoomId_userId: { classRoomId: string; userId: string } };
      }) {
        const s = getInMemoryStore();
        const key = `${args.where.classRoomId_userId.classRoomId}/${args.where.classRoomId_userId.userId}`;
        const m = s.classRoomMembers.get(key);
        return m ? { ...m } : null;
      },

      async findMany(args: {
        where: {
          classRoomId?: string;
          userId?: string | { not?: string };
        };
        include?: { classRoom?: boolean };
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        const out: Record<string, unknown>[] = [];
        for (const m of s.classRoomMembers.values()) {
          if (args.where.classRoomId && m.classRoomId !== args.where.classRoomId) continue;
          if (args.where.userId) {
            if (typeof args.where.userId === "string") {
              if (m.userId !== args.where.userId) continue;
            } else if (typeof args.where.userId === "object" && "not" in args.where.userId) {
              if (m.userId === args.where.userId.not) continue;
            }
          }
          const row: Record<string, unknown> = {};
          if (!args.select) {
            Object.assign(row, m);
          } else {
            for (const [k, v] of Object.entries(args.select)) {
              if (v && k in m) row[k] = (m as unknown as Record<string, unknown>)[k];
            }
          }
          if (args.include?.classRoom) {
            row.classRoom = s.classRooms.get(m.classRoomId) ?? null;
          }
          out.push(row);
        }
        return out;
      },

      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const classRoomId = String(args.data.classRoomId);
        const userId = String(args.data.userId);
        const key = `${classRoomId}/${userId}`;
        if (s.classRoomMembers.has(key)) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        const member = {
          classRoomId,
          userId,
          joinedAt: new Date(),
        };
        s.classRoomMembers.set(key, member);
        return { ...member };
      },

      async delete(args: {
        where: {
          classRoomId_userId: { classRoomId: string; userId: string };
        };
      }) {
        const s = getInMemoryStore();
        const { classRoomId, userId } = args.where.classRoomId_userId;
        const key = `${classRoomId}/${userId}`;
        const existing = s.classRoomMembers.get(key);
        if (!existing) throw new Error("ClassRoomMember not found");
        s.classRoomMembers.delete(key);
        return { ...existing };
      },
    },

    anonymousPost: {
      async findMany(args: {
        where?: { classRoomId?: string; tag?: string };
        orderBy?: { createdAt?: "asc" | "desc" };
      }) {
        const s = getInMemoryStore();
        const out: Record<string, unknown>[] = [];
        for (const p of s.anonymousPosts.values()) {
          if (args.where?.classRoomId && p.classRoomId !== args.where.classRoomId) continue;
          if (args.where?.tag && p.tag !== args.where.tag) continue;
          out.push({ ...p });
        }
        if (args.orderBy?.createdAt) {
          const dir = args.orderBy.createdAt === "asc" ? 1 : -1;
          out.sort((a, b) => {
            const da = (a.createdAt as Date).getTime();
            const db = (b.createdAt as Date).getTime();
            return (da - db) * dir;
          });
        }
        return out;
      },

      async create(args: { data: Record<string, unknown> }) {
        const s = getInMemoryStore();
        const id = args.data.id ? String(args.data.id) : nextAnonymousPostId(s);
        const post = {
          id,
          classRoomId: String(args.data.classRoomId),
          encryptedAuthorId: args.data.encryptedAuthorId ? String(args.data.encryptedAuthorId) : null,
          content: String(args.data.content),
          tag: args.data.tag as "CURHAT_TUGAS" | "BUTUH_TEMAN_TIM" | "TANYA_JAWABAN" | "DISKUSI_UMUM",
          createdAt: (args.data.createdAt as Date) ?? new Date(),
        };
        s.anonymousPosts.set(id, post);
        return { ...post };
      },

      async delete(args: { where: { id: string } }) {
        const s = getInMemoryStore();
        const post = s.anonymousPosts.get(args.where.id);
        if (!post) throw new Error("AnonymousPost not found");
        s.anonymousPosts.delete(args.where.id);
        return { ...post };
      },
    },

    cookedScore: {
      async findMany(args: {
        where?: {
          userId?: string;
          date?: {
            gte?: Date;
            lte?: Date;
          };
        };
        select?: Record<string, boolean>;
        orderBy?: { date?: "asc" | "desc" };
      }) {
        const s = getInMemoryStore();
        const out: Record<string, unknown>[] = [];
        for (const cs of s.cookedScores.values()) {
          if (args.where?.userId && cs.userId !== args.where.userId) continue;
          if (args.where?.date) {
            const time = cs.date.getTime();
            if (args.where.date.gte && time < args.where.date.gte.getTime()) continue;
            if (args.where.date.lte && time > args.where.date.lte.getTime()) continue;
          }
          out.push(selectProject({ ...cs }, args.select));
        }
        if (args.orderBy?.date) {
          const dir = args.orderBy.date === "asc" ? 1 : -1;
          out.sort((a, b) => {
            const da = (a.date as Date).getTime();
            const db = (b.date as Date).getTime();
            return (da - db) * dir;
          });
        }
        return out as any;
      },

      async upsert(args: {
        where: {
          userId_date: { userId: string; date: Date };
        };
        create: {
          userId: string;
          date: Date;
          cumulativeScore: number;
          tier: string;
        };
        update: {
          cumulativeScore: number;
          tier: string;
        };
      }) {
        const s = getInMemoryStore();
        const { userId, date } = args.where.userId_date;
        const key = `${userId}/${date.toISOString()}`;
        const existing = s.cookedScores.get(key);
        if (existing) {
          existing.cumulativeScore = args.update.cumulativeScore;
          existing.tier = args.update.tier as any;
          return { ...existing } as any;
        } else {
          const id = nextCookedScoreId(s);
          const cs = {
            id,
            userId,
            date,
            cumulativeScore: args.create.cumulativeScore,
            tier: args.create.tier as any,
            createdAt: new Date(),
          };
          s.cookedScores.set(key, cs);
          return { ...cs } as any;
        }
      },
    },

    academicWrapped: {
      async findMany(args: {
        where?: {
          userId?: string;
        };
        orderBy?: { weekStartDate?: "asc" | "desc" };
        take?: number;
      }) {
        const s = getInMemoryStore();
        let out: any[] = [];
        for (const aw of s.academicWrapped.values()) {
          if (args.where?.userId && aw.userId !== args.where.userId) continue;
          out.push({ ...aw });
        }
        if (args.orderBy?.weekStartDate) {
          const dir = args.orderBy.weekStartDate === "asc" ? 1 : -1;
          out.sort((a, b) => {
            const da = (a.weekStartDate as Date).getTime();
            const db = (b.weekStartDate as Date).getTime();
            return (da - db) * dir;
          });
        }
        if (args.take !== undefined) {
          out = out.slice(0, args.take);
        }
        return out;
      },

      async upsert(args: {
        where: {
          userId_weekStartDate: { userId: string; weekStartDate: Date };
        };
        create: {
          userId: string;
          weekStartDate: Date;
          weekEndDate: Date;
          totalSavedCredits: number;
          tasksCompleted: number;
          highestTier: string;
          streak: number;
          imageUrl: string | null;
        };
        update: {
          weekEndDate: Date;
          totalSavedCredits: number;
          tasksCompleted: number;
          highestTier: string;
          streak: number;
          imageUrl: string | null | undefined;
        };
      }) {
        const s = getInMemoryStore();
        const { userId, weekStartDate } = args.where.userId_weekStartDate;
        const key = `${userId}/${weekStartDate.toISOString()}`;
        const existing = s.academicWrapped.get(key);
        if (existing) {
          existing.weekEndDate = args.update.weekEndDate;
          existing.totalSavedCredits = args.update.totalSavedCredits;
          existing.tasksCompleted = args.update.tasksCompleted;
          existing.highestTier = args.update.highestTier as any;
          existing.streak = args.update.streak;
          if (args.update.imageUrl !== undefined) {
            existing.imageUrl = args.update.imageUrl;
          }
          return { ...existing } as any;
        } else {
          const id = nextAcademicWrappedId(s);
          const aw = {
            id,
            userId,
            weekStartDate,
            weekEndDate: args.create.weekEndDate,
            totalSavedCredits: args.create.totalSavedCredits,
            tasksCompleted: args.create.tasksCompleted,
            highestTier: args.create.highestTier as any,
            streak: args.create.streak,
            imageUrl: args.create.imageUrl,
            createdAt: new Date(),
          };
          s.academicWrapped.set(key, aw);
          return { ...aw } as any;
        }
      },
    },

    dailyDigestLog: {
      async create(args: {
        data: {
          userId: string;
          digestDate: Date;
          deliveryStatus: "SENT" | "FAILED";
          errorMessage?: string | null;
        };
      }) {
        const s = getInMemoryStore();
        const { userId, digestDate } = args.data;
        const key = `${userId}/${digestDate.toISOString()}`;
        if (s.dailyDigestLogs.has(key)) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        const id = nextDailyDigestLogId(s);
        const log = {
          id,
          userId,
          digestDate,
          deliveryStatus: args.data.deliveryStatus,
          errorMessage: args.data.errorMessage ?? null,
          sentAt: new Date(),
        };
        s.dailyDigestLogs.set(key, log);
        s.dailyDigestLogs.set(id, log);
        return { ...log } as any;
      },

      async update(args: {
        where: { id: string };
        data: {
          deliveryStatus?: "SENT" | "FAILED";
          errorMessage?: string | null;
        };
      }) {
        const s = getInMemoryStore();
        const log = s.dailyDigestLogs.get(args.where.id);
        if (!log) throw new Error("DailyDigestLog not found");
        if (args.data.deliveryStatus !== undefined) {
          log.deliveryStatus = args.data.deliveryStatus;
        }
        if (args.data.errorMessage !== undefined) {
          log.errorMessage = args.data.errorMessage;
        }
        return { ...log } as any;
      },
    },

    async $transaction<T>(arg: unknown): Promise<T> {
      if (Array.isArray(arg)) {
        const results: unknown[] = [];
        for (const p of arg as Array<Promise<unknown>>) {
          results.push(await p);
        }
        return results as unknown as T;
      }
      if (typeof arg === "function") {
        // The callback expects a `tx` client — pass `this` so the same in-memory
        // methods are used inside the transaction.
        return await (arg as (tx: unknown) => T | Promise<T>)(client);
      }
      throw new Error("Unsupported $transaction argument shape");
    },
  };

  return client;
}
