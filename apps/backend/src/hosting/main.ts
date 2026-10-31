import "dotenv/config";
import express from "express";
import { createApp } from "../app.js";
import { db } from "../lib/db.js";
import { firebaseHosting } from "./firebase.js";
import { flushMetrics } from "../modules/platform-dashboard/request-metrics.js";

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

// Cloud Scheduler owns periodic work, including cold-starting this service.
// In-process timers are unreliable while Cloud Run scales to zero.

process.on("SIGTERM", () => {
  server.close(() => {
    // No flush timer on Cloud Run; persist what this instance buffered before it goes away.
    void flushMetrics().finally(() => db.$disconnect()).finally(() => process.exit(0));
  });
});
