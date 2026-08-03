import { PrismaClient } from "@prisma/client";
import { tenantScopeExtension } from "./tenant-scope.js";

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"]
  }).$extends(tenantScopeExtension);
}

type ExtendedPrismaClient = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * The `tx` type `db.$transaction(async (tx) => ...)` callbacks receive.
 * Not `Prisma.TransactionClient`: that's the *unextended* shape, and once
 * `db` carries tenantScopeExtension its transaction client is a structurally
 * different (extended) type that plain `Prisma.TransactionClient` no longer
 * accepts.
 */
export type TxClient = Parameters<Parameters<ExtendedPrismaClient["$transaction"]>[0]>[0];
