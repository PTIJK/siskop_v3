import "dotenv/config";
import express from "express";
import { schedule } from "node-cron";
import { createApp } from "../app.js";
import { db } from "../lib/db.js";
import { runDailyScheduler } from "../modules/scheduler/service.js";
import { firebaseHosting } from "./firebase.js";

const app = express();
const api = createApp();
// Cloud Run supplies the immediate proxy hop. Do not trust arbitrary hop chains.
app.set("trust proxy", 1);
api.set("trust proxy", 1);
app.use(firebaseHosting());
app.use(api);
const server = app.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () => {
  console.warn("SISKOP Firebase API ready");
});

// Convenience for a single-instance/local deployment: this container calls
// its own scheduler endpoint's logic directly, in-process, at 00:05 server
// time. A multi-instance production deploy should instead point one external
// scheduler at POST /api/scheduler/run-daily (see SCHEDULER_SECRET in
// .env.example) so the job runs exactly once regardless of instance count.
schedule("5 0 * * *", () => {
  runDailyScheduler().catch((err: unknown) => console.error("Daily scheduler failed", err));
});

process.on("SIGTERM", () => {
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
});
