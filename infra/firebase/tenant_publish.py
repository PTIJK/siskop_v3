"""Publish the prepared tenant gateway using existing App Hosting resources.

The caller owns the release lock and readiness checks. This module never creates
service accounts/buckets or changes IAM. API shapes match Firebase CLI 15.12.0:
https://firebase.google.com/docs/reference/apphosting/rest/v1beta/projects.locations.backends.builds
"""
import base64
import hashlib
import json
import os
import pathlib
import re
import stat
import tempfile
import time
import urllib.parse
import uuid
import zipfile

from release_id import tenant_resource_id

PROJECT = "siskop-d0f8c"
LOCATION = "asia-southeast1"
BACKEND = f"projects/{PROJECT}/locations/{LOCATION}/backends/siskop-tenants"
API = "https://firebaseapphosting.googleapis.com/v1beta/"
SOURCE_BUCKET = "firebaseapphosting-sources-866351101735-asia-southeast1"
TIMEOUT_SECONDS = 25 * 60
POLL_SECONDS = 10

# Only build inputs, with the other workspace manifests retained for pnpm's lockfile.
FILES = {
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
    "apphosting.yaml", "apps/backend/package.json", "apps/mobile/package.json",
    "apps/frontend/package.json", "apps/frontend/index.html", "apps/frontend/tsconfig.json",
    "apps/frontend/vite.config.ts", "apps/frontend/tailwind.config.js",
    "apps/frontend/postcss.config.js", "apps/frontend/.env.staging",
    "packages/types/package.json", "packages/types/tsconfig.json",
    "packages/eslint-config/package.json", "packages/eslint-config/index.js",
    "infra/tenant-web/build.sh", "infra/tenant-web/server.mjs", "infra/tenant-web/release.json",
}
TREES = ("apps/frontend/src", "apps/frontend/public", "packages/types/src")
EXCLUDED_PARTS = {"node_modules", "dist", "coverage", "uploads", "data", "__pycache__"}
PRIVATE_NAME = re.compile(r"secret|credential|service[-_]?account|firebase-adminsdk", re.I)
PUBLIC_ENV_KEYS = {
    "VITE_PUBLIC_APP_HOST", "VITE_ONBOARDING_STAGING", "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID",
    "VITE_TENANT_BASE_DOMAIN", "VITE_PUBLIC_APP_URL",
}


def _regular_file(root, relative):
    path = root / relative
    if any(part.is_symlink() for part in [path, *path.parents] if part != root.parent):
        raise ValueError("Tenant source must not contain symlinks")
    if not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("Tenant source must contain regular files")
    return path


def create_archive(root, destination, state):
    """Create reproducible ZIP bytes; unlisted files never enter the upload."""
    root = pathlib.Path(root).resolve()
    build_id = state.get("buildId", "")
    if not re.fullmatch(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}", build_id):
        raise ValueError("An exact Cloud Build UUID is required")
    if not re.fullmatch(r"[a-f0-9]{40}", state.get("commit", "")):
        raise ValueError("An exact release commit is required")
    candidate = state.get("candidateUrl", "")
    if not re.fullmatch(r"https://[a-z0-9-]+\.a\.run\.app", candidate):
        raise ValueError("A verified API candidate URL is required")
    config = _regular_file(root, "apphosting.yaml").read_text()
    if "api-not-configured.invalid" in config or f"value: {candidate}\n" not in config:
        raise ValueError("Tenant configuration does not match the prepared API")
    marker = json.loads(_regular_file(root, "infra/tenant-web/release.json").read_text())
    if marker != {"commit": state["commit"], "buildId": build_id}:
        raise ValueError("Tenant release marker does not match this release")
    for line in _regular_file(root, "apps/frontend/.env.staging").read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and line.split("=", 1)[0] not in PUBLIC_ENV_KEYS:
            raise ValueError("Unexpected variable in public frontend configuration")
    selected = set(FILES)
    for tree in TREES:
        directory = root / tree
        if directory.is_symlink():
            raise ValueError("Tenant source must not contain symlinks")
        for parent, directories, filenames in os.walk(directory, followlinks=False):
            directories[:] = sorted(name for name in directories if not name.startswith(".")
                                    and name not in EXCLUDED_PARTS and not PRIVATE_NAME.search(name))
            if any((pathlib.Path(parent) / name).is_symlink() for name in directories):
                raise ValueError("Tenant source must not contain symlinks")
            for name in filenames:
                if name.startswith(".") or PRIVATE_NAME.search(name) or name.endswith((".pem", ".key", ".p12", ".log", ".zip", ".tsbuildinfo")):
                    continue
                selected.add((pathlib.Path(parent) / name).relative_to(root).as_posix())
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative in sorted(selected):
            path = _regular_file(root, relative)
            entry = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | (0o755 if relative.endswith(".sh") else 0o644)) << 16
            archive.writestr(entry, path.read_bytes())
    return hashlib.sha256(pathlib.Path(destination).read_bytes()).hexdigest()


def _existing(cloud, name):
    try:
        return cloud.request("GET", API + name)
    except cloud.Missing:
        return None


def _match(resource, name, expected):
    if resource.get("name") != name:
        raise RuntimeError("App Hosting returned an unexpected resource name")
    if "source" in expected:
        source = resource.get("source", {})
        archive = source.get("archive", {})
        wanted = expected["source"]["archive"]
        if (set(source) != {"archive"} or archive.get("userStorageUri") != wanted["userStorageUri"]
                or archive.get("rootDirectory", ".") != wanted["rootDirectory"]
                or archive.get("externalSignedUri")):
            raise RuntimeError("Existing App Hosting build has a different source")
    elif resource.get("build") != expected["build"]:
        raise RuntimeError("Existing App Hosting rollout targets a different build")


def _progress(resource, name, previous):
    state = resource.get("state", "STATE_UNSPECIFIED")
    if state != previous:
        print(f"App Hosting {name}: {state}", flush=True)
    logs = resource.get("buildLogsUri", "")
    if re.fullmatch(r"https://console\.cloud\.google\.com/cloud-build/builds(?:/|;)[A-Za-z0-9/?=&;._%-]+", logs):
        if state != previous:
            print(f"Build logs: {logs}", flush=True)
    return state


def _operation_name(operation):
    name = operation.get("name", "") if isinstance(operation, dict) else ""
    if not re.fullmatch(rf"projects/{PROJECT}/locations/{LOCATION}/operations/[A-Za-z0-9_-]+", name):
        raise RuntimeError("App Hosting returned an unexpected operation name")
    return name


def _wait(cloud, name, expected, operation, deadline):
    success = "READY" if "source" in expected else "SUCCEEDED"
    previous = None
    while time.monotonic() < deadline:
        if operation is not None:
            operation_name = _operation_name(operation)
            if operation.get("error"):
                resource = _existing(cloud, name)
                if resource:
                    _match(resource, name, expected)
                    _progress(resource, name, previous)
                raise RuntimeError(f"App Hosting operation failed: {operation_name}")
        resource = _existing(cloud, name)
        if resource:
            _match(resource, name, expected)
            previous = _progress(resource, name, previous)
            if previous in {"FAILED", "SKIPPED", "EXPIRED", "CANCELLED", "PAUSED"}:
                raise RuntimeError(f"App Hosting {name} ended in {previous}")
            if previous == success and (not operation or operation.get("done")):
                return resource
            if operation and operation.get("done"):
                raise RuntimeError(f"App Hosting {name} completed without {success}")
        elif operation and operation.get("done"):
            raise RuntimeError("Completed App Hosting operation has no resource")
        time.sleep(min(POLL_SECONDS, max(0, deadline - time.monotonic())))
        if time.monotonic() >= deadline:
            break
        if operation is not None:
            operation = cloud.request("GET", API + operation["name"])
            _operation_name(operation)
    raise TimeoutError("App Hosting publication exceeded 25 minutes; release lock retained")


def _ensure(cloud, name, expected, request_id, deadline, existing=None):
    resource = existing if existing is not None else _existing(cloud, name)
    operation = None
    if resource is not None:
        _match(resource, name, expected)
    else:
        parent, identifier = name.rsplit("/", 1)
        kind = "buildId" if "source" in expected else "rolloutId"
        url = API + parent + "?" + urllib.parse.urlencode({kind: identifier, "requestId": request_id})
        try:
            operation = cloud.request("POST", url, json.dumps(expected).encode())
            _operation_name(operation)
        except cloud.Conflict:
            resource = _existing(cloud, name)
            if resource is None:
                raise RuntimeError("App Hosting conflict could not be resolved") from None
            _match(resource, name, expected)
    return _wait(cloud, name, expected, operation, deadline)


def publish_tenant(cloud, state):
    """Upload, build and roll out; caller checks lock and saves/verifies release."""
    deadline = time.monotonic() + TIMEOUT_SECONDS
    with tempfile.TemporaryDirectory(prefix="siskop-tenant-source-") as directory:
        archive = pathlib.Path(directory) / "source.zip"
        digest = create_archive(pathlib.Path.cwd(), archive, state)
        identifier = tenant_resource_id(state["buildId"])
        object_name = f"releases/{identifier}/{digest}.zip"
        source_uri = f"gs://{SOURCE_BUCKET}/{object_name}"
        source = {"source": {"archive": {"userStorageUri": source_uri, "rootDirectory": "."}}}
        build_name = f"{BACKEND}/builds/{identifier}"
        build = _existing(cloud, build_name)
        if build is None:
            cloud.command(["gcloud", "storage", "cp", str(archive), source_uri,
                           "--no-clobber", f"--project={PROJECT}", "--quiet"])
            metadata = cloud.request("GET", f"https://storage.googleapis.com/storage/v1/b/{SOURCE_BUCKET}/o/" + urllib.parse.quote(object_name, safe=""))
            payload = archive.read_bytes()
            checksum = base64.b64encode(hashlib.md5(payload).digest()).decode()
            if metadata.get("md5Hash") != checksum or str(metadata.get("size")) != str(len(payload)):
                raise RuntimeError("Uploaded tenant source does not match this release")
        else:
            _match(build, build_name, source)
        request_id = uuid.uuid5(uuid.UUID(state["buildId"]), "tenant-build")
        _ensure(cloud, build_name, source, str(request_id), deadline, build)
        rollout_name = f"{BACKEND}/rollouts/{identifier}"
        rollout_id = uuid.uuid5(uuid.UUID(state["buildId"]), "tenant-rollout")
        _ensure(cloud, rollout_name, {"build": build_name}, str(rollout_id), deadline)
    return {"build": build_name, "rollout": rollout_name}
