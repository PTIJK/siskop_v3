import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/backend/package.json", import.meta.url));
const env = require("dotenv").parse(fs.readFileSync(new URL("../../apps/backend/.env.firebase-secrets.local", import.meta.url)));
const origin = "https://siskop-d0f8c.web.app";
async function check(path, status, init) {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, status, `${path}: HTTP ${response.status}`);
  const data = await response.json();
  console.log(`${init?.method ?? "GET"} ${path}: ${response.status}`);
  return data;
}
const post = (body, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
await check("/api/health", 200);
const catalog = await check("/api/onboarding/packages", 200);
assert.equal(catalog.data.checkoutAvailable, true);
assert.ok(catalog.data.packages.length > 0);
await check("/api/onboarding/status", 401);
await check("/api/auth/refresh", 401, post({}));
await check("/api/auth/register", 403, post({}));
await check("/api/onboarding/resume", 403, post({}, { Origin: "https://untrusted.example" }));
await check("/api/onboarding/webhook", 401, post({ event: "payment_session.completed" }));
for (const event of ["payment_session.completed", "payment_session.expired"]) {
  await check("/api/onboarding/webhook", 200, post({
    event, data: { id: "ps-hosted-smoke-test", reference_id: "test_session" }
  }, { "x-callback-token": env.XENDIT_WEBHOOK_TOKEN }));
}
await check("/uploads/does-not-exist", 404);
console.log("Hosted routing, catalog, auth guards and signed sample callbacks passed. No accounts or payments created.");
