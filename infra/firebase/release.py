#!/usr/bin/env python3
"""Coordinate a main release. Uses Cloud Build ADC, without Secret Manager access.

The GCS object is a generation-checked mutex across all deployment steps. A later
build can reclaim it only after Cloud Build confirms its owner has terminated.
"""
import base64
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

PROJECT = "siskop-d0f8c"
REGION = "asia-southeast2"
SERVICE = "siskop-staging-api"
IMAGE = f"{REGION}-docker.pkg.dev/{PROJECT}/siskop-staging/api"
BUCKET = f"{PROJECT}-deployments"
ORIGIN = f"https://{PROJECT}.web.app"
TENANT_BACKEND = f"projects/{PROJECT}/locations/asia-southeast1/backends/siskop-tenants"
TENANT_ORIGIN = f"https://siskop-tenants--{PROJECT}.asia-southeast1.hosted.app"
TENANT_BASE = "koperasi.inovasijayakarsa.id"
LOCK_URL = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/main-lock.json"
STATE = pathlib.Path(".release/state.json")
TERMINAL = {"SUCCESS", "FAILURE", "INTERNAL_ERROR", "TIMEOUT", "CANCELLED", "EXPIRED"}
UUID = re.compile(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\Z")


class Conflict(Exception):
    pass


class Missing(Exception):
    pass


class Cloud:
    def command(self, args):
        return subprocess.check_output(args, text=True).strip()

    def request(self, method, url, body=None):
        # Keep access tokens in memory, never in logs or process arguments.
        token = self.command(["gcloud", "auth", "print-access-token"])
        request = urllib.request.Request(url, method=method, data=body, headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        })
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
                return json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            if error.code in (409, 412):
                raise Conflict() from None
            if error.code == 404:
                raise Missing() from None
            raise RuntimeError(f"Google Cloud API returned HTTP {error.code}") from None

    def public_json(self, url):
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "siskop-cloud-build"})
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)

    def main_commit(self):
        return self.public_json("https://api.github.com/repos/PTIJK/siskop_v3/git/ref/heads/main")["object"]["sha"]

    def scheduler_status(self, origin, token):
        # Job metadata contains the app token. Keep it in memory and never pass
        # it to gcloud arguments or logs. This GET does not execute either job.
        request = urllib.request.Request(origin + "/api/scheduler/status", headers={
            "x-scheduler-token": token, "Cache-Control": "no-cache",
        })
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except (urllib.error.URLError, ValueError):
            raise RuntimeError("Scheduler readiness failed; jobs have not been activated") from None

    def create_lock(self, owner):
        url = f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o?uploadType=media&name=main-lock.json&ifGenerationMatch=0"
        return self.request("POST", url, json.dumps(owner).encode())["generation"]

    def read_lock(self):
        generation = self.request("GET", LOCK_URL)["generation"]
        return self.request("GET", LOCK_URL + "?alt=media&generation=" + generation), generation

    def delete_lock(self, generation):
        self.request("DELETE", LOCK_URL + "?ifGenerationMatch=" + generation)

    def build_status(self, build_id):
        if not UUID.fullmatch(build_id):
            raise ValueError("Invalid lock owner; investigate the lock before retrying")
        url = f"https://cloudbuild.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/builds/{build_id}"
        return self.request("GET", url)["status"]


class ReleaseLock:
    def __init__(self, cloud, sleep=time.sleep, attempts=90):
        self.cloud, self.sleep, self.attempts = cloud, sleep, attempts

    def take(self, build_id, commit):
        for _ in range(self.attempts):
            try:
                return self.cloud.create_lock({"buildId": build_id, "commit": commit})
            except Conflict:
                try:
                    owner, generation = self.cloud.read_lock()
                except Missing:
                    continue  # The previous release finished between create and read.
                if owner["buildId"] == build_id:
                    return generation
                if self.cloud.build_status(owner["buildId"]) in TERMINAL:
                    try:
                        self.cloud.delete_lock(generation)
                    except (Conflict, Missing):
                        pass  # Another build already replaced it; never delete its generation.
                else:
                    print("Another release is running; waiting for its build to finish.", flush=True)
                    self.sleep(10)
        raise TimeoutError("Release lock is busy; retry this build after the active release finishes")


def acquire(cloud, deploy, branch, commit, build_id):
    if deploy == "false":
        print("Verification only: migration and publishing are disabled.")
        return None
    if deploy != "true" or branch != "main" or not re.fullmatch(r"[a-f0-9]{40}", commit) or not UUID.fullmatch(build_id):
        raise ValueError("Publishing requires RELEASE_DEPLOY=true and an exact main commit/build ID")
    if cloud.main_commit() != commit:
        print("A newer main commit exists; this build will not publish.")
        return None
    generation = ReleaseLock(cloud).take(build_id, commit)
    if cloud.main_commit() != commit:
        cloud.delete_lock(generation)
        print("Main changed while waiting; this build will not publish.")
        return None
    return {"buildId": build_id, "commit": commit, "generation": generation}


def assert_owner(cloud, state):
    owner, generation = cloud.read_lock()
    if owner["buildId"] != state["buildId"] or generation != state["generation"]:
        raise RuntimeError("Release lock ownership changed; refusing to publish")


def gcloud(*args):
    return ["gcloud", *args, f"--project={PROJECT}", "--quiet"]


def check_api(cloud, origin):
    if cloud.public_json(origin + "/api/health").get("success") is not True:
        raise RuntimeError("API health check failed")
    catalog = cloud.public_json(origin + "/api/onboarding/packages")
    if catalog.get("success") is not True or not catalog.get("data", {}).get("checkoutAvailable") or not catalog["data"].get("packages"):
        raise RuntimeError("Database/package checkout readiness check failed")


def traffic_tag(build_id):
    if not UUID.fullmatch(build_id):
        raise ValueError("Invalid Cloud Build ID for traffic tag")
    # Encode all 128 UUID bits in 26 DNS-safe characters. Keeping the entire ID
    # prevents later builds from reusing tags pinned by Firebase Hosting.
    tag = "c" + base64.b32encode(uuid.UUID(build_id).bytes).decode("ascii").rstrip("=").lower()
    if len(tag + "-" + SERVICE) > 46:
        raise ValueError("Cloud Run traffic tag and service exceed the hostname limit")
    return tag


def backend(cloud, state, image):
    if state is None:
        return
    tag = traffic_tag(state["buildId"])
    assert_owner(cloud, state)
    if tenant_hosting_enabled():
        domain = cloud.request("GET", f"https://firebaseapphosting.googleapis.com/v1/{TENANT_BACKEND}/domains/*." + TENANT_BASE)
        status = domain.get("customDomainStatus", {})
        if any(status.get(key) != value for key, value in {
            "hostState": "HOST_ACTIVE", "ownershipState": "OWNERSHIP_ACTIVE", "certState": "CERT_ACTIVE"
        }.items()):
            raise RuntimeError("Tenant DNS and HTTPS must be ready before enabling tenant hosting")
    if not image.startswith(IMAGE + ":"):
        raise ValueError("Unexpected image repository")
    digest = cloud.command(gcloud("artifacts", "docker", "images", "describe", image, "--format=value(image_summary.digest)"))
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("Build did not resolve to an immutable image digest")
    image_ref = IMAGE + "@" + digest
    # The job receives only the database secret. No test or seed command runs here.
    cloud.command(gcloud(
        "run", "jobs", "deploy", "siskop-staging-migrate", f"--region={REGION}", f"--image={image_ref}",
        f"--service-account=siskop-staging-migrate@{PROJECT}.iam.gserviceaccount.com",
        f"--set-cloudsql-instances={PROJECT}:{REGION}:siskop-staging",
        "--set-secrets=DATABASE_URL=DATABASE_URL:2", "--set-env-vars=NODE_ENV=production",
        "--command=node", "--args=/app/apps/backend/node_modules/prisma/build/index.js,migrate,deploy,--schema=/app/apps/backend/prisma/schema.prisma",
        "--cpu=1", "--memory=512Mi", "--tasks=1", "--parallelism=1", "--max-retries=0", "--task-timeout=600s", "--execute-now", "--wait",
    ))
    cloud.command([
        "bash", "infra/firebase/deploy-api.sh", image_ref, "--no-traffic", f"--tag={tag}",
        f"--labels=commit-sha={state['commit']},cloud-build-id={state['buildId']}",
    ])
    service = json.loads(cloud.command(gcloud("run", "services", "describe", SERVICE, f"--region={REGION}", "--format=json")))
    revision = service["status"]["latestReadyRevisionName"]
    target = next(item for item in service["status"]["traffic"] if item.get("tag") == tag)
    if target.get("revisionName") != revision:
        raise RuntimeError("Candidate tag does not point to the new ready revision")
    check_api(cloud, target["url"])
    state.update({"revision": revision, "image": image_ref, "candidateUrl": target["url"]})
    STATE.write_text(json.dumps(state))
    print("Migration and candidate API checks passed; ready to publish Firebase Hosting.")


def tenant_hosting_enabled():
    value = os.environ.get("RELEASE_TENANT_HOSTING", "false")
    if value not in {"true", "false"}:
        raise ValueError("RELEASE_TENANT_HOSTING must be true or false")
    return value == "true"


def prepare_tenant(cloud, state):
    if state is None or not tenant_hosting_enabled():
        return
    assert_owner(cloud, state)
    candidate = urllib.parse.urlsplit(state["candidateUrl"])
    if candidate.scheme != "https" or not candidate.hostname or not candidate.hostname.endswith(".run.app") or candidate.username or candidate.password or candidate.path or candidate.query or candidate.fragment:
        raise ValueError("Tenant gateway requires the verified Cloud Run candidate URL")
    config = pathlib.Path("apphosting.yaml")
    text = config.read_text()
    placeholder = "value: https://api-not-configured.invalid"
    if text.count(placeholder) != 1:
        raise ValueError("Unexpected tenant deployment configuration")
    config.write_text(text.replace(placeholder, "value: " + state["candidateUrl"]))
    pathlib.Path("infra/tenant-web/release.json").write_text(json.dumps({"commit": state["commit"], "buildId": state["buildId"]}) + "\n")


def finish(cloud, state):
    if state is None:
        return
    assert_owner(cloud, state)
    deployed = cloud.public_json(ORIGIN + "/release.json?build=" + state["buildId"])
    if deployed.get("buildId") != state["buildId"] or deployed.get("commit") != state["commit"]:
        raise RuntimeError("Firebase Hosting is not serving this release")
    check_api(cloud, ORIGIN)
    if tenant_hosting_enabled():
        tenant_release = cloud.public_json(TENANT_ORIGIN + "/release.json?build=" + state["buildId"])
        if tenant_release.get("buildId") != state["buildId"] or tenant_release.get("commit") != state["commit"]:
            raise RuntimeError("Tenant App Hosting is not serving this release")
        slug = os.environ.get("RELEASE_TENANT_SMOKE_SLUG", "")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", slug):
            raise ValueError("An existing active tenant slug is required for release verification")
        tenant_origin = f"https://{slug}.{TENANT_BASE}"
        wildcard_release = cloud.public_json(tenant_origin + "/release.json?build=" + state["buildId"])
        if wildcard_release.get("buildId") != state["buildId"] or wildcard_release.get("commit") != state["commit"]:
            raise RuntimeError("Tenant wildcard is not serving this release")
        workspace = cloud.public_json(tenant_origin + "/api/workspace")
        context = workspace.get("data") or {}
        if workspace.get("success") is not True or not context.get("tenantId") or context.get("slug") != slug or context.get("isAlias") is not False:
            raise RuntimeError("Tenant gateway/database readiness check failed")
    cloud.command(gcloud("run", "services", "update-traffic", SERVICE, f"--region={REGION}", f"--to-revisions={state['revision']}=100"))
    activate_schedulers(cloud, state)
    cloud.delete_lock(state["generation"])
    print(f"Published {state['commit']} to {ORIGIN}; backend {state['revision']}.")


def activate_schedulers(cloud, state):
    """Resume prepared jobs only when their exact target serves this release."""
    origin = cloud.command(gcloud("run", "services", "describe", SERVICE, f"--region={REGION}", "--format=value(status.url)"))
    if not re.fullmatch(r"https://siskop-staging-api-[a-z0-9-]+\.a\.run\.app", origin):
        raise RuntimeError("Unexpected scheduler API origin")
    specs = json.loads(pathlib.Path(__file__).with_name("scheduler-jobs.json").read_text())
    pending = []
    for spec in specs:
        name = f"projects/{PROJECT}/locations/{REGION}/jobs/{spec['id']}"
        url = "https://cloudscheduler.googleapis.com/v1/" + name
        job = cloud.request("GET", url)
        target = job.get("httpTarget", {})
        token = target.get("headers", {}).get("x-scheduler-token")
        if (job.get("name") != name or job.get("state") not in {"PAUSED", "ENABLED"}
                or job.get("schedule") != spec["schedule"] or job.get("timeZone") != spec["timeZone"]
                or target.get("uri") != origin + spec["path"] or target.get("httpMethod") != "POST"
                or target.get("oidcToken") != {"audience": origin, "serviceAccountEmail": f"siskop-scheduler-invoker@{PROJECT}.iam.gserviceaccount.com"}
                or not isinstance(token, str) or not token or "\r" in token or "\n" in token):
            raise RuntimeError(f"Scheduler {spec['id']} needs setup-scheduler.mjs before activation")
        readiness = cloud.scheduler_status(origin, token)
        data = readiness.get("data", {})
        if (readiness.get("success") is not True or data.get("version") != 1
                or data.get("revision") != state["revision"] or data.get("daily") is not True
                or data.get("identityRecovery") is not True):
            raise RuntimeError("Serving API is not ready for both scheduled jobs; activation stopped")
        if job["state"] == "PAUSED":
            pending.append(url)
    # Validate BOTH jobs before resuming either. Repeated releases leave enabled
    # jobs alone; a failed resume keeps the release lock and can be retried.
    for url in pending:
        cloud.request("POST", url + ":resume", b"{}")
    print("Daily calculations and Firebase identity recovery schedulers are enabled.")


def main():
    cloud = Cloud()
    action = sys.argv[1]
    if action == "acquire":
        if STATE.exists():
            raise RuntimeError("Unexpected pre-existing release state")
        state = acquire(cloud, os.environ["RELEASE_DEPLOY"], os.environ.get("RELEASE_BRANCH", ""),
                        os.environ.get("RELEASE_COMMIT", ""), os.environ["RELEASE_BUILD_ID"])
        if state is not None:
            STATE.parent.mkdir(exist_ok=True)
            STATE.write_text(json.dumps(state))
    else:
        state = json.loads(STATE.read_text()) if STATE.exists() else None
        if state and (state["buildId"] != os.environ["RELEASE_BUILD_ID"] or state["commit"] != os.environ["RELEASE_COMMIT"]):
            raise RuntimeError("Release state does not belong to this build")
        if action == "backend":
            backend(cloud, state, os.environ["RELEASE_IMAGE"])
        elif action == "prepare-tenant":
            prepare_tenant(cloud, state)
        elif action == "finish":
            finish(cloud, state)
        else:
            raise ValueError("Unknown release action")


if __name__ == "__main__":
    main()
