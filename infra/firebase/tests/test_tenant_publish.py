import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
import urllib.parse
import zipfile
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("tenant_publish", pathlib.Path(__file__).parents[1] / "tenant_publish.py")
publisher = importlib.util.module_from_spec(SPEC)
with patch.object(sys, "path", [str(pathlib.Path(__file__).parents[1]), *sys.path]):
    SPEC.loader.exec_module(publisher)
STATE = {"buildId": "12345678-1234-1234-1234-123456789abc", "commit": "a" * 40,
         "candidateUrl": "https://candidate-api.a.run.app"}
RESOURCE_ID = "cb-ci2fm6asgqjdieruci2fm6e2xq"


class FakeCloud:
    class Missing(Exception):
        pass

    class Conflict(Exception):
        pass

    def __init__(self):
        self.resources = {}
        self.operations = {}
        self.calls = []
        self.commands = []
        self.upload = b""
        self.fail_build = False
        self.fail_rollout = False
        self.conflict_source = None
        self.operation_hostile = False
        self.bad_upload = False

    def command(self, args):
        self.commands.append(args)
        self.upload = pathlib.Path(args[3]).read_bytes()
        return ""

    def request(self, method, url, body=None):
        self.calls.append((method, url, body))
        if url.startswith("https://storage.googleapis.com/"):
            return {"md5Hash": base64.b64encode(hashlib.md5(self.upload).digest()).decode(),
                    "size": len(self.upload) + int(self.bad_upload)}
        self.assert_apphosting(url)
        name = url.removeprefix(publisher.API).split("?", 1)[0]
        if method == "GET":
            if "/operations/" in name:
                resource_name = self.operations[name]
                resource = self.resources[resource_name]
                failed = self.fail_build if "/builds/" in resource_name else self.fail_rollout
                resource["state"] = "FAILED" if failed else ("READY" if "/builds/" in resource_name else "SUCCEEDED")
                if failed:
                    return {"name": name, "done": True, "error": {"code": 13, "message": "private provider diagnostic"}}
                return {"name": name, "done": True, "response": resource}
            if name not in self.resources:
                raise self.Missing()
            return self.resources[name]
        expected = json.loads(body)
        identifier = next(value[0] for key, value in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).items()
                          if key in {"buildId", "rolloutId"})
        if not 3 <= len(identifier) <= 30:
            raise AssertionError("App Hosting resource IDs must contain 3 to 30 characters")
        resource_name = name + "/" + identifier
        resource = {"name": resource_name, **expected,
                    "state": "BUILDING" if "source" in expected else "PROGRESSING"}
        self.resources[resource_name] = resource
        if self.conflict_source is not None and "source" in expected:
            if self.conflict_source:
                resource["source"] = self.conflict_source
            resource["state"] = "READY"
            raise self.Conflict()
        operation_name = f"projects/{publisher.PROJECT}/locations/{publisher.LOCATION}/operations/op-{len(self.operations)}"
        self.operations[operation_name] = resource_name
        return {"name": "https://attacker.example/op" if self.operation_hostile else operation_name, "done": False}

    @staticmethod
    def assert_apphosting(url):
        if not url.startswith(publisher.API):
            raise AssertionError("Unexpected cloud endpoint: " + url)


class TenantPublisherTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        for relative in publisher.FILES:
            self.write(relative, "{}\n")
        self.write("apphosting.yaml", "env:\n  - variable: TENANT_API_ORIGIN\n    value: " + STATE["candidateUrl"] + "\n")
        self.write("infra/tenant-web/release.json", json.dumps({key: STATE[key] for key in ["commit", "buildId"]}))
        self.write("apps/frontend/dist/release.json", json.dumps({key: STATE[key] for key in ["commit", "buildId"]}))
        self.write("apps/frontend/dist/index.html", '<div id="root"></div>')
        self.write("apps/frontend/dist/assets/main.js", "export const app = 'fixture';\n")
        self.write("packages/types/src/index.ts", "export {};\n")
        self.previous = pathlib.Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.previous)
        self.sleep = patch.object(publisher.time, "sleep")
        self.sleep.start()
        self.addCleanup(self.sleep.stop)
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.output)
        self.redirect.__enter__()
        self.addCleanup(self.redirect.__exit__, None, None, None)

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def test_archive_excludes_private_generated_and_unlisted_inputs(self):
        excluded = [".env", ".release/state.json", "github-release.mjs", "node_modules/private.json",
                    "apps/backend/src/main.ts", "apps/backend/scripts/data/export.json",
                    "apps/frontend/.env.local", "apps/frontend/.env.production", "apps/frontend/src/main.ts",
                    "apps/frontend/src/.env", "apps/frontend/src/node_modules/leak.js",
                    "apps/frontend/public/service-account.json", "apps/frontend/public/key.pem",
                    "apps/frontend/public/credentials/export.json",
                    "apps/frontend/src/.turbo/cache.json", "apps/frontend/dist/.env",
                    "apps/frontend/dist/node_modules/leak.js", "apps/frontend/dist/key.pem"]
        for relative in excluded:
            self.write(relative, "PRIVATE_SENTINEL")
        self.write("apps/frontend/dist/logo.svg", "<svg />")
        destination = self.root / "source.zip"
        digest = publisher.create_archive(self.root, destination, STATE)
        first = destination.read_bytes()
        os.utime(self.root / "apps/frontend/dist/assets/main.js", (1_000_000, 1_000_000))
        self.assertEqual(digest, publisher.create_archive(self.root, destination, STATE))
        self.assertEqual(first, destination.read_bytes())
        with zipfile.ZipFile(destination) as archive:
            self.assertTrue((publisher.FILES - {"infra/tenant-web/package.json"}).issubset(archive.namelist()))
            self.assertIn("package.json", archive.namelist())
            self.assertNotIn("pnpm-lock.yaml", archive.namelist())
            self.assertIn("apps/frontend/dist/logo.svg", archive.namelist())
            self.assertTrue(set(excluded).isdisjoint(archive.namelist()))
            self.assertNotIn(b"PRIVATE_SENTINEL", b"".join(archive.read(name) for name in archive.namelist()))

    def test_symlink_artifact_and_workspace_dependencies_fail_before_upload(self):
        cloud = FakeCloud()
        path = self.root / "apps/frontend/dist/assets/main.js"
        path.unlink()
        path.symlink_to(self.root / "package.json")
        with self.assertRaisesRegex(ValueError, "symlinks"):
            publisher.publish_tenant(cloud, STATE)
        self.assertEqual(cloud.commands, [])
        path.unlink()
        self.write("apps/frontend/dist/assets/main.js", "export {}")
        self.write("infra/tenant-web/package.json", '{"dependencies":{"unexpected":"1.0.0"}}')
        with self.assertRaisesRegex(ValueError, "workspace dependencies"):
            publisher.publish_tenant(cloud, STATE)
        self.assertEqual(cloud.commands, [])

    def test_prepared_config_and_marker_are_required(self):
        cloud = FakeCloud()
        self.write("infra/tenant-web/release.json", "{}")
        with self.assertRaisesRegex(ValueError, "marker"):
            publisher.publish_tenant(cloud, STATE)
        self.assertEqual(cloud.calls, [])

    def test_stale_compiled_frontend_is_rejected_before_upload(self):
        cloud = FakeCloud()
        self.write("apps/frontend/dist/release.json", json.dumps({"commit": "b" * 40, "buildId": STATE["buildId"]}))
        with self.assertRaisesRegex(ValueError, "Built frontend"):
            publisher.publish_tenant(cloud, STATE)
        self.assertEqual(cloud.calls, [])

    def test_success_uploads_then_builds_before_rollout_without_iam_mutation(self):
        cloud = FakeCloud()
        result = publisher.publish_tenant(cloud, STATE)
        self.assertEqual(result["build"], publisher.BACKEND + "/builds/" + RESOURCE_ID)
        self.assertEqual(result["rollout"], publisher.BACKEND + "/rollouts/" + RESOURCE_ID)
        self.assertEqual(cloud.resources[result["build"]]["state"], "READY")
        self.assertEqual(cloud.resources[result["rollout"]]["state"], "SUCCEEDED")
        self.assertEqual(len(cloud.commands), 1)
        self.assertEqual(cloud.commands[0][:3], ["gcloud", "storage", "cp"])
        self.assertIn("--no-clobber", cloud.commands[0])
        self.assertIn("/releases/" + RESOURCE_ID + "/", cloud.commands[0][4])
        posts = [(url, json.loads(body)) for method, url, body in cloud.calls if method == "POST"]
        self.assertEqual(len(posts), 2)
        self.assertIn("/builds?buildId=" + RESOURCE_ID + "&", posts[0][0])
        self.assertIn("/rollouts?rolloutId=" + RESOURCE_ID + "&", posts[1][0])
        self.assertTrue(all(method in {"GET", "POST"} and (method == "GET" or "/backends/siskop-tenants/" in url)
                            for method, url, _ in cloud.calls))

    def test_build_operation_failure_never_creates_rollout_or_logs_raw_error(self):
        cloud = FakeCloud()
        cloud.fail_build = True
        with self.assertRaisesRegex(RuntimeError, "operation failed"):
            publisher.publish_tenant(cloud, STATE)
        self.assertFalse(any("/rollouts" in url for _, url, _ in cloud.calls))
        self.assertNotIn("private provider diagnostic", self.output.getvalue())

    def test_rollout_failure_is_not_success(self):
        cloud = FakeCloud()
        cloud.fail_rollout = True
        with self.assertRaisesRegex(RuntimeError, "operation failed"):
            publisher.publish_tenant(cloud, STATE)

    def test_retry_reuses_same_resources_and_rejects_changed_source(self):
        cloud = FakeCloud()
        result = publisher.publish_tenant(cloud, STATE)
        before = len(cloud.calls)
        self.assertEqual(result, publisher.publish_tenant(cloud, STATE))
        self.assertTrue(all(method == "GET" for method, _, _ in cloud.calls[before:]))
        self.assertEqual(len(cloud.commands), 1)
        self.write("apps/frontend/dist/assets/main.js", "export const changed = true;")
        with self.assertRaisesRegex(RuntimeError, "different source"):
            publisher.publish_tenant(cloud, STATE)
        self.assertEqual(len(cloud.commands), 1)

    def test_conflict_requires_matching_source(self):
        for source, succeeds in [({}, True), ({"archive": {"userStorageUri": "gs://wrong/source.zip"}}, False)]:
            with self.subTest(succeeds=succeeds):
                cloud = FakeCloud()
                cloud.conflict_source = source
                if succeeds:
                    publisher.publish_tenant(cloud, STATE)
                else:
                    with self.assertRaisesRegex(RuntimeError, "different source"):
                        publisher.publish_tenant(cloud, STATE)
                    self.assertFalse(any("/rollouts" in url for _, url, _ in cloud.calls))

    def test_existing_rollout_must_target_expected_build(self):
        cloud = FakeCloud()
        result = publisher.publish_tenant(cloud, STATE)
        cloud.resources[result["rollout"]]["build"] = publisher.BACKEND + "/builds/other"
        with self.assertRaisesRegex(RuntimeError, "different build"):
            publisher.publish_tenant(cloud, STATE)

    def test_bad_upload_and_hostile_operation_fail_closed(self):
        for option, error in [("bad_upload", "Uploaded tenant source"), ("operation_hostile", "unexpected operation")]:
            with self.subTest(option=option):
                cloud = FakeCloud()
                setattr(cloud, option, True)
                with self.assertRaisesRegex(RuntimeError, error):
                    publisher.publish_tenant(cloud, STATE)
                self.assertFalse(any("/rollouts" in url for _, url, _ in cloud.calls))

    def test_completed_nonready_build_and_timeout_fail(self):
        cloud = FakeCloud()
        expected = {"source": {"archive": {"userStorageUri": "gs://bucket/source.zip", "rootDirectory": "."}}}
        name = publisher.BACKEND + "/builds/fixture"
        cloud.resources[name] = {"name": name, **expected, "state": "BUILT"}
        operation = {"name": f"projects/{publisher.PROJECT}/locations/{publisher.LOCATION}/operations/fixture", "done": True}
        with self.assertRaisesRegex(RuntimeError, "without READY"):
            publisher._wait(cloud, name, expected, operation, float("inf"))
        with patch.object(publisher.time, "monotonic", return_value=1501):
            with self.assertRaisesRegex(TimeoutError, "25 minutes"):
                publisher._wait(cloud, name, expected, None, 1500)

    def test_malformed_create_operation_cannot_be_treated_as_success(self):
        for response in [None, {}, {"done": True}, {"name": "https://attacker.example/op"}]:
            with self.subTest(response=response):
                cloud = FakeCloud()
                original = cloud.request

                def request(method, url, body=None):
                    result = original(method, url, body)
                    if method == "POST":
                        for resource in cloud.resources.values():
                            resource["state"] = "READY"
                        return response
                    return result

                cloud.request = request
                with self.assertRaisesRegex(RuntimeError, "unexpected operation"):
                    publisher.publish_tenant(cloud, STATE)
                self.assertFalse(any("/rollouts" in url for _, url, _ in cloud.calls))


if __name__ == "__main__":
    unittest.main()
