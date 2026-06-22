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
          createdAt: now,
          updatedAt: now,
        };
        s.users.set(id, user);
        s.usersByEmail.set(email, id);
        return { ...user };
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
        where?: { classRoomId?: string };
        select?: Record<string, boolean>;
      }) {
        const s = getInMemoryStore();
        const out: Record<string, unknown>[] = [];
        for (const t of s.tasks.values()) {
          if (args.where?.classRoomId && t.classRoomId !== args.where.classRoomId) continue;
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
        where: { userId?: string; status?: unknown };
        include?: { task?: boolean };
      }) {
        const s = getInMemoryStore();
        const userId = args.where.userId as string | undefined;
        const statusFilter = args.where.status as
          | { in?: string[] }
          | string
          | undefined;
        const out: Record<string, unknown>[] = [];
        for (const p of s.userTaskProgress.values()) {
          if (userId && p.userId !== userId) continue;
          if (statusFilter && typeof statusFilter === "object" && "in" in statusFilter && statusFilter.in) {
            if (!statusFilter.in.includes(p.status)) continue;
          }
          const row: Record<string, unknown> = { ...p };
          if (args.include?.task) {
            row.task = s.tasks.get(p.taskId) ?? null;
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
        const id = args.data.id ? String(args.data.id) : `class_${Math.random().toString(36).substring(2, 11)}`;
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
