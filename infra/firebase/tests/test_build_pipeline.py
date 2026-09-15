import ast
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]


def dependencies():
    """Read the id/waitFor subset of this deliberately simple pipeline YAML."""
    steps = {}
    current = None
    for line in (ROOT / "infra/firebase/cloudbuild-release.yaml").read_text().splitlines():
        if line.startswith("  - id: "):
            current = line.split(": ", 1)[1]
            steps[current] = list(steps)
        elif current and line.startswith("    waitFor: "):
            steps[current] = [item for item in ast.literal_eval(line.split(": ", 1)[1]) if item != "-"]
    return steps


class PipelineGateTests(unittest.TestCase):
    def test_backend_build_starts_independently_of_verification(self):
        self.assertEqual(dependencies()["build-backend"], [])

    def test_publishing_requires_both_verified_source_and_successful_image(self):
        steps = dependencies()
        def ancestors(step):
            parents = set(steps[step])
            return parents.union(*(ancestors(parent) for parent in parents))
        for step in ["push-backend", "acquire-release", "migrate-and-deploy-backend", "publish-frontend", "verify-and-finish-release"]:
            with self.subTest(step=step):
                self.assertTrue({"verify-and-build-frontend", "build-backend"}.issubset(ancestors(step)))


class BuildCommandsTests(unittest.TestCase):
    def run_script(self, action, failure=""):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = pathlib.Path(temporary.name)
        log = directory / "commands.jsonl"
        docker = directory / "docker"
        docker.write_text("""#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['COMMAND_LOG'],'a') as out:out.write(json.dumps(args)+'\\n')
if args[0]=='pull':sys.exit(1)  # Empty cache must remain a valid cold build.
if os.environ.get('FAIL_COMMAND')=='dependencies' and '--target' in args:sys.exit(9)
if os.environ.get('FAIL_COMMAND')=='push' and args[0]=='push':sys.exit(9)
if os.environ.get('FAIL_COMMAND')=='cache-push' and args[0]=='push' and ':cache-' in args[1]:sys.exit(9)
""")
        docker.chmod(0o755)
        result = subprocess.run(["bash", str(ROOT / "infra/firebase/build-backend.sh"), action], cwd=ROOT,
                                env={**os.environ, "PATH": str(directory) + os.pathsep + os.environ["PATH"],
                                     "COMMAND_LOG": str(log), "FAIL_COMMAND": failure,
                                     "RELEASE_IMAGE": "asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api:test-build"},
                                text=True, capture_output=True)
        calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return result, calls

    def test_cold_cache_builds_both_dependencies_and_runtime_without_pushing(self):
        result, calls = self.run_script("build")
        self.assertEqual(result.returncode, 0, result.stderr)
        builds = [call for call in calls if call[0] == "build"]
        self.assertEqual(len(builds), 2)
        self.assertIn("dependencies", builds[0])
        self.assertTrue(any("dependencies-test-build" in arg for arg in builds[1]))
        self.assertFalse(any(call[0] == "push" for call in calls))

    def test_failed_dependency_build_stops_before_runtime_build(self):
        result, calls = self.run_script("build", "dependencies")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len([call for call in calls if call[0] == "build"]), 1)

    def test_publication_pushes_the_release_image_before_updating_caches(self):
        result, calls = self.run_script("push")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[0], ["push", "asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api:test-build"])
        self.assertEqual(len([call for call in calls if call[0] == "push"]), 3)

    def test_failed_release_push_never_publishes_cache_tags(self):
        result, calls = self.run_script("push", "push")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 1)

    def test_cache_upload_failure_does_not_block_a_verified_release(self):
        result, calls = self.run_script("push", "cache-push")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len([call for call in calls if call[0] == "push"]), 3)
        self.assertIn("cache", result.stdout)


class VerificationGateTests(unittest.TestCase):
    def test_failed_checks_stop_before_building_frontend(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = pathlib.Path(directory)
            log = directory / "commands.jsonl"
            for executable in ["apt-get", "npm", "pnpm", "node", "python3"]:
                path = directory / executable
                path.write_text("""#!/bin/bash
printf '%s\\n' "$(basename "$0") $*" >> "$COMMAND_LOG"
if [[ "$(basename "$0") $*" == 'pnpm run test' ]]; then exit 7; fi
""")
                path.chmod(0o755)
            result = subprocess.run(["bash", "infra/firebase/verify-release.sh"], cwd=ROOT, capture_output=True,
                                    env={**os.environ, "PATH": str(directory) + os.pathsep + os.environ["PATH"],
                                         "COMMAND_LOG": str(log), "DATABASE_URL": "postgresql://postgres:ci-only-password@siskop-ci-postgres:5432/siskop_ci_test"})
            self.assertNotEqual(result.returncode, 0)
            calls = log.read_text()
            self.assertIn("pnpm run test", calls)
            self.assertNotIn("vite build", calls)


if __name__ == "__main__":
    unittest.main()
