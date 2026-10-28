import copy
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import urllib.error

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("verified_source", ROOT / "infra/firebase/verified_source.py")
source = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)
MAIN, HEAD, TREE = "a" * 40, "b" * 40, "c" * 40
NOW = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)


class VerifiedSourceTests(unittest.TestCase):
    def setUp(self):
        self.run = {
            "id": 7, "run_number": 9, "run_attempt": 1,
            "workflow_id": source.POLICY["workflowId"], "path": source.POLICY["workflowPath"],
            "head_sha": MAIN, "head_branch": "main", "event": "push",
            "repository": {"full_name": source.POLICY["repository"]},
            "head_repository": {"full_name": source.POLICY["repository"]},
            "status": "completed", "conclusion": "success"
        }
        self.job = {"name": "verify", "status": "completed", "conclusion": "success", "completed_at": NOW.isoformat()}
        self.rows = {
            f"commits/{MAIN}": {"sha": MAIN, "commit": {"tree": {"sha": TREE}}},
            f"commits/{HEAD}": {"sha": HEAD, "commit": {"tree": {"sha": TREE}}},
            f"commits/{MAIN}/pulls?per_page=20": [],
            "actions/runs/7/jobs?filter=latest&per_page=100": {"total_count": 1, "jobs": [self.job]}
        }
        for commit in (MAIN, HEAD):
            self.rows[f"contents/{source.POLICY['workflowPath']}?ref={commit}"] = {
                "type": "file", "path": source.POLICY["workflowPath"], "sha": source.POLICY["workflowBlob"]
            }
        self.runs = {MAIN: [self.run], HEAD: []}

    def get(self, path):
        prefix = "actions/workflows/ci.yml/runs?head_sha="
        if path.startswith(prefix):
            return {"workflow_runs": copy.deepcopy(self.runs[path.removeprefix(prefix).split("&")[0]])}
        return copy.deepcopy(self.rows[path])

    def proof(self):
        return source.find_verified_source(MAIN, self.get, NOW)

    def use_pr(self):
        self.runs[MAIN] = []
        self.run.update(head_sha=HEAD, event="pull_request", head_branch="feature/example")
        self.runs[HEAD] = [self.run]
        pr = {"number": 3, "merged": True, "merge_commit_sha": MAIN,
              "base": {"ref": "main", "repo": {"full_name": source.POLICY["repository"]}},
              "head": {"sha": HEAD, "repo": {"full_name": source.POLICY["repository"]}}}
        self.rows[f"commits/{MAIN}/pulls?per_page=20"] = [{"number": 3}]
        self.rows["pulls/3"] = pr

    def test_reuses_successful_main_ci(self):
        proof = self.proof()
        self.assertEqual(proof["verifiedCommit"], MAIN)
        self.assertEqual(proof["tree"], TREE)

    def test_reuses_squashed_pr_only_for_the_identical_tree(self):
        self.use_pr()
        self.assertEqual(self.proof()["verifiedCommit"], HEAD)

    def test_running_main_ci_does_not_hide_a_completed_exact_pr_result(self):
        self.use_pr()
        self.runs[MAIN] = [{**self.run, "head_sha": MAIN, "event": "push", "head_branch": "main", "status": "in_progress", "conclusion": None}]
        self.assertEqual(self.proof()["verifiedCommit"], HEAD)

    def test_changed_merge_tree_requires_full_verification(self):
        self.use_pr()
        self.rows[f"commits/{HEAD}"]["commit"]["tree"]["sha"] = "d" * 40
        self.assertIsNone(self.proof())

    def test_failed_pending_cancelled_or_skipped_ci_cannot_be_reused(self):
        for status, conclusion in [("completed", "failure"), ("in_progress", None), ("completed", "cancelled"), ("completed", "skipped")]:
            with self.subTest(status=status, conclusion=conclusion):
                self.run.update(status=status, conclusion=conclusion)
                self.assertIsNone(self.proof())

    def test_newer_failure_cannot_be_hidden_by_an_older_success(self):
        self.runs[MAIN] = [self.run, {**self.run, "id": 8, "run_number": 10, "conclusion": "failure"}]
        self.assertIsNone(self.proof())

    def test_wrong_workflow_repository_commit_or_event_cannot_be_reused(self):
        for field, value in [("workflow_id", 123), ("path", ".github/workflows/other.yml"), ("head_sha", "d" * 40), ("event", "workflow_dispatch"), ("head_branch", "develop"), ("repository", {"full_name": "elsewhere/repo"}), ("head_repository", {"full_name": "fork/repo"})]:
            with self.subTest(field=field):
                original = self.run[field]
                self.run[field] = value
                self.assertIsNone(self.proof())
                self.run[field] = original

    def test_a_different_ci_definition_requires_full_verification(self):
        self.rows[f"contents/{source.POLICY['workflowPath']}?ref={MAIN}"]["sha"] = "e" * 40
        self.assertIsNone(self.proof())

    def test_verify_job_must_actually_succeed(self):
        self.job["conclusion"] = "skipped"
        self.assertIsNone(self.proof())

    def test_old_or_future_job_results_cannot_be_reused(self):
        for delta in (timedelta(days=-2), timedelta(hours=1)):
            with self.subTest(delta=delta):
                self.job["completed_at"] = (NOW + delta).isoformat()
                self.assertIsNone(self.proof())

    def test_pr_must_be_merged_into_this_main_commit(self):
        self.use_pr()
        self.rows["pulls/3"]["merge_commit_sha"] = "e" * 40
        self.assertIsNone(self.proof())

    def test_fork_pr_requires_full_verification(self):
        self.use_pr()
        self.rows["pulls/3"]["head"]["repo"]["full_name"] = "fork/repo"
        self.assertIsNone(self.proof())

    def test_pinned_workflow_is_the_reviewed_file_with_immutable_head_checkout(self):
        data = (ROOT / source.POLICY["workflowPath"]).read_bytes()
        digest = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        self.assertEqual(digest, source.POLICY["workflowBlob"])
        self.assertIn(b"ref: ${{ github.event.pull_request.head.sha || github.sha }}", data)
        self.assertIn(b"image: postgres:17", data)


class VerificationDecisionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        original = Path.cwd()
        self.addCleanup(os.chdir, original)
        os.chdir(self.temporary.name)
        self.environment = patch.dict(os.environ, {
            "RELEASE_DEPLOY": "true", "RELEASE_VERIFICATION": "reuse-ci", "RELEASE_BRANCH": "main",
            "RELEASE_COMMIT": MAIN, "RELEASE_BUILD_ID": "12345678-1234-1234-1234-123456789abc"
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def run_decision(self):
        with redirect_stdout(io.StringIO()):
            source.main()
        return json.loads(Path(".release/verification.json").read_text())

    def test_no_proof_keeps_the_full_suite_and_database(self):
        with patch.object(source, "find_verified_source", return_value=None):
            self.assertEqual(self.run_decision()["mode"], "full")
        self.assertFalse(Path(".release/reuse-ci.ok").exists())

    def test_network_failure_keeps_full_verification(self):
        with patch.object(source, "find_verified_source", side_effect=urllib.error.URLError("unavailable")):
            self.assertEqual(self.run_decision()["mode"], "full")
        self.assertFalse(Path(".release/reuse-ci.ok").exists())

    def test_manual_verification_does_not_query_or_reuse_github(self):
        with patch.dict(os.environ, {"RELEASE_DEPLOY": "false"}), patch.object(source, "find_verified_source") as find:
            self.assertEqual(self.run_decision()["mode"], "full")
            find.assert_not_called()

    def test_explicit_full_mode_does_not_query_github(self):
        with patch.dict(os.environ, {"RELEASE_VERIFICATION": "full"}), patch.object(source, "find_verified_source") as find:
            self.assertEqual(self.run_decision()["mode"], "full")
            find.assert_not_called()

    def test_preexisting_marker_is_never_trusted(self):
        Path(".release").mkdir()
        Path(".release/reuse-ci.ok").write_text(MAIN)
        with patch.object(source, "find_verified_source") as find:
            with self.assertRaisesRegex(ValueError, "Pre-existing"):
                self.run_decision()
            find.assert_not_called()

    def test_reuse_records_this_build_and_writes_its_exact_commit_marker(self):
        proof = {"verifiedCommit": HEAD, "tree": TREE, "runId": 7,
                 "workflowBlob": source.POLICY["workflowBlob"], "completedAt": NOW.isoformat()}
        with patch.object(source, "find_verified_source", return_value=proof):
            record = self.run_decision()
        self.assertEqual(record["commit"], MAIN)
        self.assertEqual(record["buildId"], os.environ["RELEASE_BUILD_ID"])
        self.assertEqual(record["mode"], "reuse-ci")
        self.assertEqual(Path(".release/reuse-ci.ok").read_text(), MAIN)


if __name__ == "__main__":
    unittest.main()
