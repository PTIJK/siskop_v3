import "dotenv/config";
import { db } from "../../lib/db.js";
import { identityProvisioner } from "./service.js";

try {
  if (process.env.FIREBASE_ACCOUNT_PROVISIONING_ENABLED !== "true") throw new Error("Provisioning is disabled");
  console.warn(await identityProvisioner.reconcile());
} catch {
  console.error("Identity reconciliation failed; review Firebase permissions and retry.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
