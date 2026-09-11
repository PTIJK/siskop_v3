#!/usr/bin/env node
// Private values travel via environment or stdin, never command arguments/logs.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const require = createRequire(new URL("../../apps/backend/package.json", import.meta.url));
const { parse } = require("dotenv");
const { z } = require("zod");
const project = "siskop-d0f8c";
const account = "yudith.octo@gmail.com";
const privateFile = fileURLToPath(new URL("../../apps/backend/.env.resend.local", import.meta.url));

function cloud(args, input) {
  const result = spawnSync(process.env.GCLOUD_BIN || "gcloud", [...args, `--project=${project}`, `--account=${account}`, "--quiet"], { input, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`gcloud ${args.slice(0, 3).join(" ")} failed; check your Google Cloud access.`);
  return result.stdout.trim();
}

async function main() {
  const action = process.argv[2];
  if (!["check", "test", "configure"].includes(action)) throw new Error("Usage: node infra/firebase/resend-setup.mjs check | test YOUR_RESEND_ACCOUNT_EMAIL | configure");
  const values = parse(readFileSync(privateFile));
  if (!values.RESEND_API_KEY?.startsWith("re_") || !values.RESEND_FROM_EMAIL?.trim())
    throw new Error("Fill RESEND_API_KEY and RESEND_FROM_EMAIL in apps/backend/.env.resend.local first.");
  const from = values.RESEND_FROM_EMAIL.trim();
  const senderAddress = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (/[\r\n]/.test(from) || !z.string().email().safeParse(senderAddress).success) throw new Error("RESEND_FROM_EMAIL must be a valid sender address.");
  if (action === "check") {
    console.log("Resend key is present; sender format is valid. This local check does not verify API access or DNS.");
    return;
  }
  if (action === "test") {
    const recipient = z.string().email().safeParse(process.argv[3]);
    if (!recipient.success) throw new Error("Supply your Resend account email as the test recipient.");
    const { buildRegistrationEmail, sendRegistrationEmail } = await import("../../apps/backend/dist/modules/onboarding/resend.js");
    const orderId = `setup-${randomUUID()}`;
    const payload = buildRegistrationEmail({ orderId, email: recipient.data, adminName: "Pengelola SISKOP", tenantName: "Koperasi Uji", packageName: "Paket Demo", amount: "0", authProvider: "password" }, from, `https://${project}.web.app/login`);
    payload.subject = "[TEST] Konfirmasi pendaftaran SISKOP";
    const notice = "Email pengujian integrasi. Tidak ada pendaftaran atau pembayaran yang dibuat.";
    payload.text = notice + "\n\n" + payload.text;
    payload.html = payload.html.replace("<h1 ", `<p>${notice}</p><h1 `);
    const id = await sendRegistrationEmail(payload, orderId, values.RESEND_API_KEY);
    console.log(`Resend accepted test email ${id}. Check your inbox and the Resend Emails page.`);
    return;
  }
  // Do not read or delete the release mutex; configure only when no release owns it.
  const locks = cloud(["storage", "ls", `gs://${project}-deployments/`]);
  if (locks.split("\n").some((line) => line.endsWith("/main-lock.json")))
    throw new Error("A deployment lock exists. Finish/recover that build before configuring Resend.");
  const existing = JSON.parse(cloud(["secrets", "list", "--format=json(name)"]));
  const names = new Set(existing.map((item) => item.name.split("/").pop()));
  const bindings = [];
  for (const name of ["RESEND_API_KEY", "RESEND_FROM_EMAIL"]) {
    if (!names.has(name)) cloud(["secrets", "create", name, "--replication-policy=automatic"]);
    const version = cloud(["secrets", "versions", "add", name, "--data-file=-", "--format=value(name)"], values[name].trim()).split("/").pop();
    if (!/^\d+$/.test(version)) throw new Error("Could not determine the created secret version.");
    cloud(["secrets", "add-iam-policy-binding", name, `--member=serviceAccount:siskop-staging-api@${project}.iam.gserviceaccount.com`, "--role=roles/secretmanager.secretAccessor"]);
    bindings.push(`${name}=${name}:${version}`);
  }
  cloud(["run", "services", "update", "siskop-staging-api", "--region=asia-southeast2", `--update-secrets=${bindings.join(",")}`, "--no-traffic"]);
  console.log("Resend secret versions are attached to a candidate API revision. Merge feature/email into main to publish the feature through Cloud Build.");
}

main().catch((error) => {
  if (error?.code === "ENOENT") console.error("Private configuration or compiled backend is missing. Follow infra/firebase/RESEND.md.");
  else if (error?.code === "ERR_MODULE_NOT_FOUND") console.error("Build @siskop/backend before testing Resend.");
  else console.error(error instanceof Error ? error.message : "Resend setup failed.");
  process.exitCode = 1;
});
