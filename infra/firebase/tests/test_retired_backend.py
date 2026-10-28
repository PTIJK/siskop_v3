"""Prevent retired entry points from reconnecting to the previous database."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("release", ROOT / "infra/firebase/release.py")
release = importlib.util.module_from_spec(SPEC)
with patch.object(sys, "path", [str(ROOT / "infra/firebase"), *sys.path]):
    SPEC.loader.exec_module(release)


class RetiredBackendTests(unittest.TestCase):
    def test_legacy_backend_is_rejected_before_any_cloud_access(self):
        cloud = Mock()
        with patch.dict(os.environ, {"RELEASE_BACKEND": "cloudrun"}):
            with self.assertRaisesRegex(ValueError, "Only the Contabo backend"):
                release.backend(cloud, {"buildId": "example"}, "image")
        self.assertEqual(cloud.mock_calls, [])

    def test_missing_backend_defaults_to_contabo(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": "example"}, "8")
        with patch.dict(os.environ, {"RELEASE_TENANT_HOSTING": "false"}), patch.object(release, "publish_contabo_backend") as publish:
            os.environ.pop("RELEASE_BACKEND", None)
            release.backend(cloud, {"buildId": "example", "generation": "8"}, "image")
            publish.assert_called_once()

    def test_old_deployment_and_database_helpers_fail_without_cloud_or_db_access(self):
        with tempfile.TemporaryDirectory() as directory:
            trap = Path(directory) / "gcloud"
            trap.write_text('#!/bin/sh\ntouch "$COMMAND_LOG"\nexit 91\n')
            trap.chmod(0o755)
            log = Path(directory) / "unexpected-cloud-command"
            env = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"], "COMMAND_LOG": str(log)}
            for command in [["bash", "infra/firebase/deploy-api.sh", "image"], ["node", "infra/firebase/database.mjs", "migrate"]]:
                result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 1)
                self.assertIn("Retired:", result.stderr)
            self.assertFalse(log.exists())

    def test_legacy_release_state_cannot_resume_schedulers_or_finish(self):
        cloud = Mock()
        for action in [release.activate_schedulers, release.finish]:
            with self.assertRaisesRegex(ValueError, "Contabo deployment receipt"):
                action(cloud, {"revision": "previous-cloudrun-revision"})
        self.assertEqual(cloud.mock_calls, [])


if __name__ == "__main__":
    unittest.main()
