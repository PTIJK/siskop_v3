"""Find successful GitHub CI for exactly the source tree being released."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

POLICY = json.loads(Path(__file__).with_name("ci-verification-policy.json").read_text())
SHA = re.compile(r"[a-f0-9]{40}\Z")
UUID = re.compile(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\Z")


def _tree(commit, get):
    if not isinstance(commit, str) or not SHA.fullmatch(commit):
        return None
    data = get(f"commits/{commit}")
    tree = data.get("commit", {}).get("tree", {}).get("sha", "")
    return tree if data.get("sha") == commit and SHA.fullmatch(tree) else None


def _candidate(commit, tree, event, get, now):
    definition = get(f"contents/{POLICY['workflowPath']}?ref={commit}")
    if definition.get("type") != "file" or definition.get("path") != POLICY["workflowPath"] or definition.get("sha") != POLICY["workflowBlob"]:
        return None, False
    runs = get(f"actions/workflows/ci.yml/runs?head_sha={commit}&per_page=20").get("workflow_runs", [])
    runs = [run for run in runs if (
        run.get("workflow_id") == POLICY["workflowId"] and run.get("path") == POLICY["workflowPath"]
        and run.get("head_sha") == commit and run.get("event") == event
        and run.get("repository", {}).get("full_name") == POLICY["repository"]
        and run.get("head_repository", {}).get("full_name") == POLICY["repository"]
        and (event != "push" or run.get("head_branch") == "main")
        and type(run.get("id")) is int and run["id"] > 0
        and type(run.get("run_number")) is int and run["run_number"] > 0
    )]
    if not runs:
        return None, False
    # Never choose an older success over a more recent failure or rerun.
    run = max(runs, key=lambda row: (row["run_number"], row.get("run_attempt", 1), row["id"]))
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        return None, run.get("status") == "completed" and run.get("conclusion") == "failure"
    jobs = get(f"actions/runs/{run['id']}/jobs?filter=latest&per_page=100").get("jobs", [])
    if len(jobs) != 1:
        return None, False
    job = jobs[0]
    if job.get("name") != POLICY["jobName"] or job.get("status") != "completed" or job.get("conclusion") != "success":
        return None, False
    try:
        completed = datetime.fromisoformat(job["completed_at"].replace("Z", "+00:00"))
        age = (now - completed).total_seconds()
    except (KeyError, TypeError, ValueError):
        return None, False
    if not -300 <= age <= POLICY["maxAgeSeconds"]:
        return None, False
    return {"verifiedCommit": commit, "tree": tree, "runId": run["id"],
            "workflowBlob": POLICY["workflowBlob"], "completedAt": completed.isoformat()}, False


def find_verified_source(commit, get, now):
    tree = _tree(commit, get)
    if not tree:
        return None
    proof, failed = _candidate(commit, tree, "push", get, now)
    if proof or failed:
        return proof
    for association in get(f"commits/{commit}/pulls?per_page=20"):
        number = association.get("number")
        if type(number) is not int or number <= 0:
            continue
        pr = get(f"pulls/{number}")
        head = pr.get("head", {})
        if (pr.get("merged") is not True or pr.get("merge_commit_sha") != commit
                or pr.get("base", {}).get("ref") != "main"
                or pr.get("base", {}).get("repo", {}).get("full_name") != POLICY["repository"]
                or head.get("repo", {}).get("full_name") != POLICY["repository"]):
            continue
        verified = head.get("sha")
        # Squash/merge hashes may differ; every tracked byte must still match.
        if _tree(verified, get) != tree:
            continue
        proof, _ = _candidate(verified, tree, "pull_request", get, now)
        if proof:
            return proof
    return None


class PublicGitHub:
    """Bounded public metadata reads. No credentials, polling or reruns."""
    def __init__(self):
        self.deadline = time.monotonic() + 45
        self.cache = {}

    def __call__(self, path):
        if path in self.cache:
            return self.cache[path]
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("CI lookup budget exhausted")
        request = urllib.request.Request(f"https://api.github.com/repos/{POLICY['repository']}/{path}", headers={
            "Accept": "application/vnd.github+json", "User-Agent": "siskop-source-verification", "Cache-Control": "no-cache"
        })
        with urllib.request.urlopen(request, timeout=min(5, remaining)) as response:
            payload = response.read(2 * 1024 * 1024 + 1)
        if len(payload) > 2 * 1024 * 1024:
            raise ValueError("CI metadata response too large")
        self.cache[path] = json.loads(payload)
        return self.cache[path]


def main():
    mode = os.environ.get("RELEASE_VERIFICATION", "full")
    if mode not in {"full", "reuse-ci"}:
        raise ValueError("Unexpected verification mode")
    output = Path(".release")
    output.mkdir(exist_ok=True)
    decision, marker = output / "verification.json", output / "reuse-ci.ok"
    if decision.exists() or marker.exists():
        raise ValueError("Pre-existing verification evidence is not allowed")
    commit, build = os.environ.get("RELEASE_COMMIT", ""), os.environ.get("RELEASE_BUILD_ID", "")
    proof = None
    if mode == "reuse-ci" and os.environ.get("RELEASE_DEPLOY") == "true":
        if os.environ.get("RELEASE_BRANCH") != "main" or not SHA.fullmatch(commit) or not UUID.fullmatch(build):
            raise ValueError("CI reuse requires an exact main release")
        try:
            proof = find_verified_source(commit, PublicGitHub(), datetime.now(timezone.utc))
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, AttributeError):
            # Missing, stale or unavailable proof must never bypass testing.
            proof = None
    record = {"version": POLICY["version"], "mode": "reuse-ci" if proof else "full", "commit": commit, "buildId": build}
    if proof:
        record.update(proof)
    with decision.open("x") as file:
        json.dump(record, file)
    if proof:
        with marker.open("x") as file:
            file.write(commit)
        print(f"Reusing identical-source CI: https://github.com/{POLICY['repository']}/actions/runs/{proof['runId']}")
        print("Verified source tree: " + proof["tree"])
    else:
        print("Full verification required: no reusable, successful identical-source CI proof.")


if __name__ == "__main__":
    main()
