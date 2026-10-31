import "dotenv/config";
import { createApp } from "./app.js";
import { flushMetrics, startMetricsFlush } from "./modules/platform-dashboard/request-metrics.js";

const port = Number(process.env.PORT ?? 3001);

startMetricsFlush();
createApp().listen(port, () => {
  console.warn(`SISKOP backend listening on http://localhost:${port}`);
});

process.once("SIGTERM", () => {
  void flushMetrics().finally(() => process.exit(0));
});
