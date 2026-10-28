from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class VerificationPathTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        scripts = self.root / "infra/firebase"
        scripts.mkdir(parents=True)
        for name in ["verify-release.sh", "prepare-test-database.sh", "build-verified-frontend.sh", "build-web-assets.sh", "check-ci-proof.mjs", "ci-verification-policy.json"]:
            shutil.copyfile(ROOT / "infra/firebase" / name, scripts / name)
        commands = self.root / "bin"
        commands.mkdir()
        stub = f"""#!{sys.executable}
import json,os,pathlib,subprocess,sys
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
with open(os.environ['COMMAND_LOG'],'a') as file:file.write(json.dumps([name,*args])+'\\n')
if name=='node' and args==['infra/firebase/check-ci-proof.mjs']:
    sys.exit(subprocess.run([{shutil.which('node')!r},*args]).returncode)
if ' '.join([name,*args])==os.environ.get('FAIL_COMMAND'):sys.exit(7)
"""
        for name in ["node", "pnpm", "npm", "python3", "apt-get", "docker"]:
            command = commands / name
            command.write_text(stub)
            command.chmod(0o755)
        self.log = self.root / "commands.jsonl"
        self.env = {**os.environ, "PATH": str(commands) + os.pathsep + os.environ["PATH"], "COMMAND_LOG": str(self.log),
                    "RELEASE_VERIFICATION": "reuse-ci", "RELEASE_DEPLOY": "true", "RELEASE_BRANCH": "main",
                    "RELEASE_COMMIT": "a" * 40, "RELEASE_BUILD_ID": "12345678-1234-1234-1234-123456789abc",
                    "DATABASE_URL": "postgresql://postgres:ci-only-password@siskop-ci-postgres:5432/siskop_ci_test"}

    def evidence(self, mode):
        directory = self.root / ".release"
        directory.mkdir()
        policy = json.loads((ROOT / "infra/firebase/ci-verification-policy.json").read_text())
        record = {"version": 1, "mode": mode, "commit": self.env["RELEASE_COMMIT"], "buildId": self.env["RELEASE_BUILD_ID"]}
        if mode == "reuse-ci":
            record.update(verifiedCommit="b" * 40, tree="c" * 40, runId=7, workflowBlob=policy["workflowBlob"], completedAt=datetime.now(timezone.utc).isoformat())
            (directory / "reuse-ci.ok").write_text(record["commit"])
        (directory / "verification.json").write_text(json.dumps(record))

    def run_script(self, name):
        return subprocess.run(["bash", "infra/firebase/" + name], cwd=self.root, env=self.env, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_valid_evidence_skips_only_duplicate_database_and_full_tests(self):
        self.evidence("reuse-ci")
        self.assertEqual(self.run_script("prepare-test-database.sh").returncode, 0)
        result = self.run_script("verify-release.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertFalse(any(call[0] == "docker" for call in calls))
        self.assertNotIn(["pnpm", "run", "test"], calls)
        self.assertFalse(any(call[0] == "apt-get" for call in calls))
        self.assertIn(["python3", "-m", "unittest", "discover", "-s", "infra/firebase/tests", "-v"], calls)
        self.assertIn(["node", "--test", "infra/tenant-web/server.test.mjs"], calls)
        self.assertIn(["pnpm", "--filter", "@siskop/types", "build"], calls)
        self.assertIn(["pnpm", "--filter", "@siskop/frontend", "exec", "vite", "build", "--mode", "staging"], calls)
        self.assertIn(["pnpm", "--filter", "@siskop/mobile", "exec", "vite", "build"], calls)

    def test_missing_ci_proof_keeps_the_database_and_entire_test_suite(self):
        self.evidence("full")
        self.assertEqual(self.run_script("prepare-test-database.sh").returncode, 0)
        result = self.run_script("verify-release.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any(call[:2] == ["docker", "run"] for call in self.calls()))
        self.assertIn(["pnpm", "run", "test"], self.calls())
        self.assertIn(["pnpm", "--filter", "@siskop/backend", "exec", "prisma", "migrate", "deploy"], self.calls())

    def test_wrong_commit_marker_stops_before_database_or_publication(self):
        self.evidence("reuse-ci")
        (self.root / ".release/reuse-ci.ok").write_text("d" * 40)
        self.assertNotEqual(self.run_script("prepare-test-database.sh").returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_invalid_build_proof_cannot_enter_the_fast_path(self):
        self.evidence("reuse-ci")
        self.env["RELEASE_BUILD_ID"] = "87654321-1234-1234-1234-123456789abc"
        self.assertNotEqual(self.run_script("verify-release.sh").returncode, 0)
        self.assertFalse(any(call[0] == "pnpm" for call in self.calls()))

    def test_fast_path_contract_failure_stops_before_browser_artifacts(self):
        self.evidence("reuse-ci")
        self.env["FAIL_COMMAND"] = "python3 -m unittest discover -s infra/firebase/tests -v"
        self.assertNotEqual(self.run_script("verify-release.sh").returncode, 0)
        self.assertFalse(any("vite" in call for call in self.calls()))


if __name__ == "__main__":
    unittest.main()
