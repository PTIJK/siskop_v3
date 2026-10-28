import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { GlobalSetupContext } from "vitest/node";
import { testDatabaseUrl, testWorkerCount } from "./database-isolation.js";

declare module "vitest" {
  export interface ProvidedContext { siskopTestDatabases: string[] }
}

export default async function setup({ provide }: GlobalSetupContext) {
  const count = testWorkerCount();
  const base = testDatabaseUrl(process.env.DATABASE_URL ?? "");
  const template = base.pathname.slice(1);
  const admin = new URL(base);
  admin.pathname = "/postgres";
  admin.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ datasourceUrl: admin.toString() });
  const token = randomBytes(8).toString("hex");
  const created: string[] = [];
  const urls: string[] = [];
  const close = async () => {
    const errors: unknown[] = [];
    try {
      for (const name of [...created].reverse()) {
        try { await db.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`); }
        catch (error) { errors.push(error); }
      }
    } finally { await db.$disconnect(); }
    if (errors.length) throw new AggregateError(errors, "Could not clean up isolated test databases");
  };
  try {
    // CI/pre-push already migrated the base test DB. Clone it before any test
    // clients connect; every fork pool slot gets its own complete database.
    for (let worker = 1; worker <= count; worker++) {
      const name = `siskop_vitest_${token}_w${worker}_test`;
      await db.$executeRawUnsafe(`CREATE DATABASE "${name}" WITH TEMPLATE "${template}"`);
      created.push(name);
      const url = new URL(base);
      url.pathname = `/${name}`;
      url.searchParams.set("connection_limit", "3");
      // A developer may have already run serial tests against the template.
      // Clear only our new clone, preserving migration history and the base DB.
      const isolated = new PrismaClient({ datasourceUrl: url.toString() });
      try {
        const tables = await isolated.$queryRaw<{ tablename: string }[]>`
          SELECT tablename FROM pg_tables
          WHERE schemaname = ${url.searchParams.get("schema") ?? "public"}
            AND tablename <> '_prisma_migrations'
        `;
        const schema = url.searchParams.get("schema") ?? "public";
        const quoted = (value: string) => '"' + value.replaceAll('"', '""') + '"';
        if (tables.length) await isolated.$executeRawUnsafe(
          `TRUNCATE TABLE ${tables.map(row => `${quoted(schema)}.${quoted(row.tablename)}`).join(", ")} RESTART IDENTITY CASCADE`
        );
      } finally { await isolated.$disconnect(); }
      urls.push(url.toString());
    }
    provide("siskopTestDatabases", urls);
    console.log(`Prepared ${count} isolated PostgreSQL test databases.`);
    return close;
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Test database setup/cleanup failed"); }
    throw error;
  }
}
