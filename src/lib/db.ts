import { PrismaClient } from "@/generated/prisma";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { AsyncLocalStorage } from "async_hooks";
import ws from "ws";

// WebSocket Integration: Evaluate only in server environments
if (typeof window === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

// ─── CONTEXT ISOLATION ──────────────────────────────────────────────────────

export interface UserContext {
  userId: string;
}

export const userContextStore = new AsyncLocalStorage<UserContext>();

/**
 * Utility function to wrap execution within an isolated user context.
 */
export function withUserContext<T>(
  userId: string,
  callback: () => Promise<T> | T
): Promise<T> | T {
  return userContextStore.run({ userId }, callback);
}

// ─── PRISMA CLIENT EXTENSION ────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL || "";
// @ts-ignore - The types for PoolConfig and Pool might mismatch depending on versions, ignore the assignment error
const pool = new Pool({ connectionString });
const adapter = new PrismaNeon({ connectionString });

function createPrismaClient() {
  const baseClient = new PrismaClient({ adapter });

  // The extended client enforces row-level security via AsyncLocalStorage.
  // The un-scoped base client is exported separately as `baseDb` for privileged
  // cross-tenant operations (e.g. classroom task propagation writes
  // UserTaskProgress rows for many users at once — Requirement 8.7).
  return baseClient.$extends({
    query: {
      task: {
        async $allOperations({ operation, args, query }: { operation: string; args: any; query: (args: any) => any }) {
          const context = userContextStore.getStore();

          if (context?.userId) {
            if (['findMany', 'findFirst', 'findUnique', 'update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy'].includes(operation)) {
              args.where = { ...args.where, creatorId: context.userId };
            }
            if (['create', 'createMany'].includes(operation)) {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((d: any) => ({ ...d, creatorId: context.userId }));
              } else if (args.data) {
                args.data = { ...args.data, creatorId: context.userId };
              }
            }
          }

          return query(args);
        },
      },
      userTaskProgress: {
        async $allOperations({ operation, args, query }: { operation: string; args: any; query: (args: any) => any }) {
          const context = userContextStore.getStore();

          if (context?.userId) {
            if (['findMany', 'findFirst', 'findUnique', 'update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy'].includes(operation)) {
              args.where = { ...args.where, userId: context.userId };
            }
            if (['create', 'createMany'].includes(operation)) {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((d: any) => ({ ...d, userId: context.userId }));
              } else if (args.data) {
                args.data = { ...args.data, userId: context.userId };
              }
            }
          }

          return query(args);
        },
      },
      cookedScore: {
        async $allOperations({ operation, args, query }: { operation: string; args: any; query: (args: any) => any }) {
          const context = userContextStore.getStore();

          if (context?.userId) {
            if (['findMany', 'findFirst', 'findUnique', 'update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy'].includes(operation)) {
              args.where = { ...args.where, userId: context.userId };
            }
            if (['create', 'createMany'].includes(operation)) {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((d: any) => ({ ...d, userId: context.userId }));
              } else if (args.data) {
                args.data = { ...args.data, userId: context.userId };
              }
            }
          }

          return query(args);
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var prisma: ExtendedPrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaBase: PrismaClient | undefined;
}

/**
 * Multi-tenant-scoped client. Use this in all request-bound code paths; it
 * transparently injects the active userId via AsyncLocalStorage.
 */
export const db = globalThis.prisma ?? createPrismaClient();

/**
 * Un-scoped base client. Use ONLY for privileged operations that must cross
 * tenant boundaries (classroom task propagation, cron jobs, etc.). Never use
 * this to serve direct user requests without an explicit userId filter.
 */
export const baseDb = globalThis.prismaBase ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = db;
  globalThis.prismaBase = baseDb;
}
