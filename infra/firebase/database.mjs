import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const backend = fileURLToPath(new URL("../../apps/backend/", import.meta.url));
const require = createRequire(`${backend}package.json`);
const env = require("dotenv").parse(fs.readFileSync(`${backend}.env.firebase-secrets.local`));
const url = new URL(env.DATABASE_URL);
if (url.searchParams.get("host") !== "/cloudsql/siskop-d0f8c:asia-southeast2:siskop-staging") {
  throw new Error("This helper is restricted to the configured SISKOP staging instance.");
}
url.hostname = "127.0.0.1";
url.port = "55434";
url.searchParams.delete("host");
const command = process.argv[2] ?? "check";
if (command === "migrate") {
  const result = spawnSync(`${backend}node_modules/.bin/prisma`, ["migrate", "deploy"], {
    cwd: backend,
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: "utf8"
  });
  console.log(`${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(url.toString(), "[DATABASE_URL]"));
  process.exit(result.status ?? 1);
}
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
try {
  if (command === "seed") {
    if (!env.XENDIT_SECRET_KEY?.startsWith("xnd_development_")) throw new Error("Test-mode Xendit key required.");
    await db.subscriptionPackage.upsert({
      where: { id: "pkg_lengkap_demo" },
      update: {},
      create: {
        id: "pkg_lengkap_demo",
        name: "Paket Lengkap (Demo)",
        price: "500000",
        modules: ["accounting"],
        maxUsers: 20,
        maxMembers: 500,
        whitelabelEnabled: true
      }
    });
    console.log("Staging demo package ready; no users or passwords seeded.");
  } else if (command === "check") {
    console.log(
      JSON.stringify({
        connected: true,
        packages: await db.subscriptionPackage.count(),
        tenants: await db.tenant.count()
      })
    );
  } else {
    throw new Error("Use check, migrate, or seed.");
  }
} catch (error) {
  console.error("Staging database operation failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
