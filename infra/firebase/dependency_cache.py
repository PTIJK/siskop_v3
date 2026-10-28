"""Optional, dependency-keyed pnpm store reuse; never caches test results."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import time

BUCKET = "gs://siskop-d0f8c-deployments/dependency-cache/frontend-v1"
STORE = Path(".release/pnpm-store")
ARCHIVE = Path(".release/dependency-store.tar.gz")
HIT = Path(".release/dependency-cache-hit")
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 2 * 1024 * 1024 * 1024


def cache_key(root=Path("."), scope="frontend"):
    digest = hashlib.sha256()
    # Store format/platform and base-image family are deliberate cache inputs.
    digest.update(("v1:node22:pnpm11.19.0:linux-amd64:bookworm:" + scope + ":" + time.strftime("%Y-%m", time.gmtime())).encode())
    inputs = {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"}
    inputs.update(str(file.relative_to(root)) for pattern in ["apps/*/package.json", "packages/*/package.json"] for file in root.glob(pattern))
    for name in sorted(inputs):
        file = root / name
        digest.update(name.encode() + b"\0" + (file.read_bytes() if file.exists() else b"<absent>") + b"\0")
    return digest.hexdigest()


def copy_object(source, destination, upload=False):
    args = ["gcloud", "storage", "cp", source, destination, "--quiet"]
    if upload:
        args.append("--if-generation-match=0")  # Concurrent builds cannot replace a cache entry.
    return subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45).returncode == 0


def restore_archive(archive, destination):
    """Only ordinary, bounded files/directories can enter the package store."""
    if archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Dependency archive is too large")
    expanded = 0
    with tarfile.open(archive, "r|gz") as source:
        for count, member in enumerate(source):
            parts = PurePosixPath(member.name).parts
            if (count >= 200000 or not parts or member.name.startswith("/") or ".." in parts
                    or not (member.isfile() or member.isdir())):
                raise ValueError("Unsupported dependency archive entry")
            expanded += member.size
            if expanded > MAX_EXPANDED:
                raise ValueError("Expanded dependency archive is too large")
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as data, target.open("xb") as output:
                    shutil.copyfileobj(data, output)
                target.chmod(member.mode & 0o777)


def main(action):
    if action not in {"restore", "save"}:
        raise ValueError("Expected restore or save")
    # Manual verification and branch builds must not read/write remote caches.
    if os.environ.get("RELEASE_DEPLOY") != "true" or os.environ.get("RELEASE_BRANCH") != "main":
        print("Dependency cache disabled for this verification build.")
        return
    decision = json.loads(Path(".release/verification.json").read_text())
    if decision.get("commit") != os.environ.get("RELEASE_COMMIT") or decision.get("buildId") != os.environ.get("RELEASE_BUILD_ID"):
        raise ValueError("Dependency cache decision belongs to another build")
    scope = "frontend" if decision.get("mode") == "reuse-ci" else "full"
    key = cache_key(scope=scope)
    url = f"{BUCKET}/{key}.tar.gz"
    staging = Path(".release/pnpm-store-restoring")
    try:
        if action == "restore":
            if STORE.exists() or staging.exists() or HIT.exists():
                raise ValueError("Dependency store must start empty")
            if not copy_object(url, str(ARCHIVE)):
                print("Dependency cache miss; packages will be downloaded normally.")
                return
            staging.mkdir()
            restore_archive(ARCHIVE, staging)
            staging.rename(STORE)
            HIT.write_text(key)
            print("Dependency cache restored; frozen-lockfile install still validates packages.")
        elif HIT.exists() and HIT.read_text() == key:
            print("Dependency cache already exists; no upload needed.")
        elif STORE.is_dir():
            with tarfile.open(ARCHIVE, "w:gz", compresslevel=1, dereference=True) as output:
                for file in STORE.rglob("*"):
                    if file.is_symlink() or not (file.is_file() or file.is_dir()):
                        raise ValueError("Unsupported package-store entry")
                    output.add(file, arcname=str(file.relative_to(STORE)), recursive=False)
            if ARCHIVE.stat().st_size <= MAX_ARCHIVE and copy_object(str(ARCHIVE), url, upload=True):
                print("Dependency cache saved for later builds.")
            else:
                print("Dependency cache upload skipped/unavailable; release is unaffected.")
    except (OSError, ValueError, tarfile.TarError, subprocess.SubprocessError):
        print("Dependency cache unavailable; normal package installation/release continues.")
    finally:
        ARCHIVE.unlink(missing_ok=True)
        if staging.exists():
            shutil.rmtree(staging)


if __name__ == "__main__":
    main(sys.argv[1])
