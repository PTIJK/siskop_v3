#!/usr/bin/env node
// Run once as a project administrator. Uses the caller's gcloud account/ADC.
//
// Root cause this fixes: main.ts's in-process node-cron only fires while a
// container instance happens to be alive at 00:05 server time. siskop-staging-api
// runs with --min-instances=0 (deploy-api.sh), so Cloud Run scales it to zero
// overnight and the daily savings-interest/loan-KOL job silently never runs.
// This script points a real Cloud Scheduler job at the existing
// POST /api/scheduler/run-daily endpoint (routes.ts) instead, which cold-starts
// the service on demand. The endpoint's own accrual logic already self-heals a
// missed day via `lastInterestAt` (see modules/savings/service.ts), so this is
// the deployment-side half of the fix, not a change to that logic.
//
// Idempotent: safe to re-run. It never rotates SCHEDULER_SECRET once created,
// so re-running after the secret is already attached to a live revision won't
// invalidate it. Secret values never pass through a printed log line, matching
// resend-setup.mjs's convention for the app's other secrets.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const project = "siskop-d0f8c";
const region = "asia-southeast2";
const account = "yudith.octo@gmail.com";
const service = "siskop-staging-api";
const runtimeSa = `${service}@${project}.iam.gserviceaccount.com`;
const invokerAccountId = "siskop-scheduler-invoker";
const invokerSa = `${invokerAccountId}@${project}.iam.gserviceaccount.com`;
const jobName = "siskop-daily-scheduler";

function cloud(args, input) {
  const result = spawnSync(
    process.env.GCLOUD_BIN || "gcloud",
    [...args, `--project=${project}`, `--account=${account}`, "--quiet"],
    { input, encoding: "utf8" }
  );
  if (result.error || result.status !== 0) {
    throw new Error(`gcloud ${args.slice(0, 3).join(" ")} failed: ${(result.stderr || String(result.error)).trim()}`);
  }
  return result.stdout.trim();
}

function exists(args) {
  const result = spawnSync(
    process.env.GCLOUD_BIN || "gcloud",
    [...args, `--project=${project}`, `--account=${account}`, "--quiet"],
    { encoding: "utf8" }
  );
  return result.status === 0;
}

function main() {
  const existingSecrets = new Set(
    JSON.parse(cloud(["secrets", "list", "--format=json(name)"])).map((item) => item.name.split("/").pop())
  );

  let secretVersion;
  if (!existingSecrets.has("SCHEDULER_SECRET")) {
    cloud(["secrets", "create", "SCHEDULER_SECRET", "--replication-policy=automatic"]);
    const value = randomBytes(32).toString("hex");
    secretVersion = cloud(
      ["secrets", "versions", "add", "SCHEDULER_SECRET", "--data-file=-", "--format=value(name)"],
      value
    ).split("/").pop();
    console.log(`Created SCHEDULER_SECRET version ${secretVersion}. Set it in deploy-api.sh's --update-secrets (currently pinned to :1) if this isn't version 1.`);
  } else {
    secretVersion = cloud([
      "secrets", "versions", "list", "SCHEDULER_SECRET",
      "--filter=state=ENABLED", "--sort-by=~createTime", "--limit=1", "--format=value(name)"
    ]);
    console.log(`SCHEDULER_SECRET already exists at version ${secretVersion}; leaving its value unchanged.`);
  }
  cloud([
    "secrets", "add-iam-policy-binding", "SCHEDULER_SECRET",
    `--member=serviceAccount:${runtimeSa}`, "--role=roles/secretmanager.secretAccessor"
  ]);

  // Attach to a no-traffic candidate revision now so the endpoint can validate
  // the header immediately; the next Cloud Build release (once deploy-api.sh
  // carries this binding) is what actually ships it to live traffic.
  cloud([
    "run", "services", "update", service, `--region=${region}`,
    `--update-secrets=SCHEDULER_SECRET=SCHEDULER_SECRET:${secretVersion}`, "--no-traffic"
  ]);

  if (exists(["iam", "service-accounts", "describe", invokerSa])) {
    console.log(`${invokerAccountId} already exists.`);
  } else {
    cloud([
      "iam", "service-accounts", "create", invokerAccountId,
      "--display-name=Cloud Scheduler -> siskop-staging-api invoker"
    ]);
  }
  // Least privilege: this identity can only invoke this one Cloud Run service.
  cloud([
    "run", "services", "add-iam-policy-binding", service, `--region=${region}`,
    `--member=serviceAccount:${invokerSa}`, "--role=roles/run.invoker"
  ]);

  const runUrl = cloud(["run", "services", "describe", service, `--region=${region}`, "--format=value(status.url)"]);
  const token = cloud(["secrets", "versions", "access", secretVersion, "--secret=SCHEDULER_SECRET"]);

  const jobArgs = [
    "scheduler", "jobs", exists(["scheduler", "jobs", "describe", jobName, `--location=${region}`]) ? "update" : "create",
    "http", jobName,
    `--location=${region}`,
    "--schedule=5 0 * * *",
    "--time-zone=UTC",
    `--uri=${runUrl}/api/scheduler/run-daily`,
    "--http-method=POST",
    `--oidc-service-account-email=${invokerSa}`,
    `--oidc-token-audience=${runUrl}`,
    `--headers=x-scheduler-token=${token}`,
    // Matches Cloud Run's own --timeout=60 in deploy-api.sh; the job should
    // not out-wait the service it's calling.
    "--attempt-deadline=60s"
  ];
  cloud(jobArgs);
  console.log(`"${jobName}" is configured: POST ${runUrl}/api/scheduler/run-daily at 00:05 UTC daily, authenticated via OIDC as ${invokerAccountId}.`);
}

main();
