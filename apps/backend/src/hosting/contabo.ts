import "dotenv/config";
import express from "express";
import { createApp } from "../app.js";
import { db } from "../lib/db.js";
import { firebaseHosting } from "./firebase.js";
import { contaboIngress } from "./contabo-ingress.js";

if (process.env.SISKOP_HOSTING !== "contabo" || process.env.STORAGE_DRIVER !== "gcs" ||
    !process.env.SCHEDULER_OIDC_AUDIENCE || !process.env.CENTRAL_GATEWAY_SECRET || !process.env.SISKOP_RELEASE_ID) {
  throw new Error("Contabo runtime configuration is incomplete");
}
const database = new URL(process.env.DATABASE_URL ?? "");
if (database.hostname !== "postgres" || database.pathname !== "/siskop_staging" || database.username !== "siskop_runtime") {
  throw new Error("Contabo API requires its private SISKOP runtime database");
}
const server = express();
// The dedicated host proxy supplies the immediate hop; it must replace XFF.
server.set("trust proxy", 1);
server.use(contaboIngress);
server.use(firebaseHosting());
const api = createApp();
api.set("trust proxy", 1);
server.use(api);
server.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "SISKOP gateway required" } });
});
const listener = server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
process.on("SIGTERM", () => listener.close(() => { void db.$disconnect().finally(() => process.exit(0)); }));
