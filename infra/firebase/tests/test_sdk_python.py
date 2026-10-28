import ast
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class SdkPythonTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        # No Python on PATH: only an absolute SDK interpreter can run the script.
        (self.bin / "dirname").symlink_to(shutil.which("dirname"))
        self.python = self.directory / "SDK runtime" / "python"
        self.python.parent.mkdir()
        self.python.symlink_to(sys.executable)
        self.sdk = self.directory / "Google Cloud SDK"
        self.ca = self.sdk / "lib/third_party/certifi/cacert.pem"
        self.ca.parent.mkdir(parents=True)
        self.ca.write_text("fixture CA bundle")
        gcloud = self.bin / "gcloud"
        gcloud.write_text('''#!/bin/sh
case "$*" in
  'info --format=value(basic.python_location)') printf '%s\\n' "$TEST_SDK_PYTHON" ;;
  'info --format=value(installation.sdk_root)') printf '%s\\n' "$TEST_SDK_ROOT" ;;
  *) exit 9 ;;
esac
''')
        gcloud.chmod(0o755)
        self.env = {**os.environ, "PATH": str(self.bin), "TEST_SDK_PYTHON": str(self.python), "TEST_SDK_ROOT": str(self.sdk)}

    def run_python(self, *args):
        return subprocess.run(["/bin/bash", str(ROOT / "infra/firebase/run-sdk-python.sh"), *args],
                              cwd=self.directory, env=self.env, capture_output=True, text=True)

    def test_bundled_python_runs_without_python_on_path_and_preserves_arguments(self):
        code = 'import os,sys,json; print(json.dumps({"args":sys.argv[1:],"ca":os.environ["SSL_CERT_FILE"],"cwd":os.getcwd()}))'
        result = self.run_python("-c", code, "argument with spaces", "restore")
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(result.stdout)
        self.assertEqual(record["args"], ["argument with spaces", "restore"])
        self.assertEqual(record["ca"], str(self.ca))
        self.assertEqual(Path(record["cwd"]), ROOT)

    def test_missing_sdk_interpreter_stops_before_running_script(self):
        self.env["TEST_SDK_PYTHON"] = str(self.directory / "missing-python")
        result = self.run_python("-c", 'print("must not run")')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_missing_ca_bundle_stops_before_network_capable_script(self):
        self.ca.unlink()
        result = self.run_python("-c", 'print("must not run")')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_child_failure_is_propagated_to_cloud_build(self):
        self.assertEqual(self.run_python("-c", "raise SystemExit(7)").returncode, 7)

    def test_every_sdk_step_bootstraps_python_through_bash(self):
        pipeline = (ROOT / "infra/firebase/cloudbuild-release.yaml").read_text()
        expected = {
            "verify-ci-source": ["infra/firebase/run-sdk-python.sh", "infra/firebase/verified_source.py"],
            "restore-frontend-dependencies": ["infra/firebase/run-sdk-python.sh", "infra/firebase/dependency_cache.py", "restore"],
            "save-frontend-dependencies": ["infra/firebase/run-sdk-python.sh", "infra/firebase/dependency_cache.py", "save"],
        }
        seen = set()
        for block in pipeline.split("  - id: ")[1:]:
            name = block.splitlines()[0]
            if "name: gcr.io/google.com/cloudsdktool/google-cloud-cli:stable" not in block:
                continue
            with self.subTest(step=name):
                self.assertIn("    entrypoint: bash\n", block)
                self.assertNotIn("    entrypoint: python3\n", block)
                args = next(line.strip().removeprefix("args: ") for line in block.splitlines() if line.startswith("    args: "))
                args = ast.literal_eval(args)
                if name in expected:
                    self.assertEqual(args, expected[name])
                    seen.add(name)
                else:
                    self.assertEqual(args[0], "infra/firebase/run-release.sh")
        self.assertEqual(seen, set(expected))


if __name__ == "__main__":
    unittest.main()
