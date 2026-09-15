import base64
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
import uuid
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("release", pathlib.Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(SPEC)
with patch.object(sys, "path", [str(pathlib.Path(__file__).parents[1]), *sys.path]):
    SPEC.loader.exec_module(release)

BUILD = "12345678-1234-1234-1234-123456789abc"
OTHER = "abcdefab-1234-1234-1234-123456789abc"
COMMIT = "a" * 40


class CloudBuildStatusTests(unittest.TestCase):
    def test_login_readiness_requires_actual_frontend_html(self):
        cloud = release.Cloud()
        with patch.object(release.urllib.request, "urlopen") as open_url:
            response = open_url.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'<html><div id="root"></div></html>'
            cloud.check_login_page("https://alpha.example/login")
            response.read.assert_called_once_with(1024 * 1024)

    def test_marker_or_error_body_does_not_prove_login_readiness(self):
        cloud = release.Cloud()
        for status, body in [(200, b'{"commit":"abc"}'), (200, b'Not found'), (404, b'<div id="root"></div>')]:
            with self.subTest(status=status, body=body), patch.object(release.urllib.request, "urlopen") as open_url:
                response = open_url.return_value.__enter__.return_value
                response.status, response.read.return_value = status, body
                with self.assertRaisesRegex(RuntimeError, "Tenant login HTML"):
                    cloud.check_login_page("https://alpha.example/login")

    def test_active_outer_build_does_not_read_tenant_rollout(self):
        cloud = release.Cloud()
        for status in ["QUEUED", "WORKING", "STATUS_UNKNOWN"]:
            with self.subTest(status=status), patch.object(cloud, "request", return_value={"status": status}) as request:
                self.assertEqual(cloud.build_status(BUILD), status)
                request.assert_called_once_with("GET", f"https://cloudbuild.googleapis.com/v1/projects/{release.PROJECT}/locations/{release.REGION}/builds/{BUILD}")

    def test_pending_or_reconciling_rollout_keeps_terminal_outer_build_active(self):
        cloud = release.Cloud()
        unsettled = [{"state": state, "reconciling": False} for state in
                     ["STATE_UNSPECIFIED", "QUEUED", "PENDING_BUILD", "PROGRESSING", "PAUSED", "CANCELLED", "SKIPPED"]]
        unsettled += [{"state": state, "reconciling": True} for state in ["SUCCEEDED", "FAILED"]]
        for rollout in unsettled:
            with self.subTest(rollout=rollout), patch.object(cloud, "request", side_effect=[{"status": "TIMEOUT"}, rollout]) as request:
                self.assertNotIn(cloud.build_status(BUILD), release.TERMINAL)
                self.assertEqual(request.call_args.args, ("GET", f"https://firebaseapphosting.googleapis.com/v1beta/{release.TENANT_BACKEND}/rollouts/cb-ci2fm6asgqjdieruci2fm6e2xq"))

    def test_settled_rollout_preserves_terminal_outer_result(self):
        cloud = release.Cloud()
        for status in release.TERMINAL:
            for state in ["SUCCEEDED", "FAILED"]:
                # Protobuf JSON may omit a false boolean; both encodings settle.
                for fields in [{}, {"reconciling": False}]:
                    with self.subTest(status=status, state=state, fields=fields):
                        with patch.object(cloud, "request", side_effect=[{"status": status}, {"state": state, **fields}]):
                            self.assertEqual(cloud.build_status(BUILD), status)

    def test_missing_rollout_preserves_terminal_outer_result(self):
        cloud = release.Cloud()
        with patch.object(cloud, "request", side_effect=[{"status": "FAILURE"}, release.Missing()]):
            self.assertEqual(cloud.build_status(BUILD), "FAILURE")

    def test_rollout_read_error_does_not_reclaim_lock(self):
        cloud = release.Cloud()
        with patch.object(cloud, "create_lock", side_effect=release.Conflict()), \
             patch.object(cloud, "read_lock", return_value=({"buildId": OTHER}, "8")), \
             patch.object(cloud, "request", side_effect=[{"status": "FAILURE"}, RuntimeError("provider unavailable")]), \
             patch.object(cloud, "delete_lock") as delete:
            with self.assertRaisesRegex(RuntimeError, "provider unavailable"):
                release.ReleaseLock(cloud, sleep=lambda _: None, attempts=1).take(BUILD, COMMIT)
            delete.assert_not_called()

    def test_pending_rollout_does_not_reclaim_lock(self):
        cloud = release.Cloud()
        with patch.object(cloud, "create_lock", side_effect=release.Conflict()), \
             patch.object(cloud, "read_lock", return_value=({"buildId": OTHER}, "8")), \
             patch.object(cloud, "request", side_effect=[{"status": "CANCELLED"}, {"state": "PROGRESSING"}]), \
             patch.object(cloud, "delete_lock") as delete:
            with self.assertRaisesRegex(TimeoutError, "Release lock is busy"):
                release.ReleaseLock(cloud, sleep=lambda _: None, attempts=1).take(BUILD, COMMIT)
            delete.assert_not_called()


class ReleaseSafetyTests(unittest.TestCase):
    def setUp(self):
        # Keep the build's activation flag out of tests that use default mocks.
        environment = patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "false"})
        environment.start()
        self.addCleanup(environment.stop)

    @patch.object(release, "activate_schedulers")
    def test_successful_tenant_release_checks_wildcard_before_promoting_api(self, activate):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        marker = {"buildId": BUILD, "commit": COMMIT}
        cloud.public_json.side_effect = [
            marker, {"success": True}, {"success": True, "data": {"checkoutAvailable": True, "packages": [{}]}},
            marker, marker, {"success": True, "data": {"tenantId": "tenant-alpha", "slug": "alpha", "isAlias": False}}
        ]
        with patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true", "RELEASE_TENANT_SMOKE_SLUG": "alpha"}):
            release.finish(cloud, {"buildId": BUILD, "generation": "8", "commit": COMMIT, "revision": "api-revision"})
        cloud.public_json.assert_any_call("https://alpha." + release.TENANT_BASE + "/release.json?build=" + BUILD)
        self.assertIn("--to-revisions=api-revision=100", cloud.command.call_args.args[0])
        cloud.delete_lock.assert_called_once_with("8")
        activate.assert_called_once()

    def test_incorrect_wildcard_release_stops_promotion(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        marker = {"buildId": BUILD, "commit": COMMIT}
        cloud.public_json.side_effect = [
            marker, {"success": True}, {"success": True, "data": {"checkoutAvailable": True, "packages": [{}]}},
            marker, {"buildId": OTHER, "commit": COMMIT}
        ]
        with patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true", "RELEASE_TENANT_SMOKE_SLUG": "alpha"}):
            with self.assertRaisesRegex(RuntimeError, "wildcard"):
                release.finish(cloud, {"buildId": BUILD, "generation": "8", "commit": COMMIT, "revision": "api-revision"})
        cloud.command.assert_not_called()
        cloud.delete_lock.assert_not_called()

    def test_pending_tenant_dns_stops_before_database_migration(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        cloud.request.return_value = {"customDomainStatus": {"hostState": "HOST_NON_FAH"}}
        with patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true"}):
            with self.assertRaisesRegex(RuntimeError, "DNS and HTTPS"):
                release.backend(cloud, {"buildId": BUILD, "generation": "8"}, release.IMAGE + ":test")
        cloud.command.assert_not_called()

    def test_tenant_gateway_is_pinned_to_candidate_and_same_release(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        state = {"buildId": BUILD, "generation": "8", "commit": COMMIT, "candidateUrl": "https://candidate-api.a.run.app"}
        with tempfile.TemporaryDirectory() as directory, patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true"}):
            previous = pathlib.Path.cwd()
            try:
                release.os.chdir(directory)
                pathlib.Path("apphosting.yaml").write_text("value: https://api-not-configured.invalid\n")
                pathlib.Path("infra/tenant-web").mkdir(parents=True)
                release.prepare_tenant(cloud, state)
                self.assertIn(state["candidateUrl"], pathlib.Path("apphosting.yaml").read_text())
                self.assertEqual(json.loads(pathlib.Path("infra/tenant-web/release.json").read_text()), {"commit": COMMIT, "buildId": BUILD})
            finally:
                release.os.chdir(previous)

    def test_failed_tenant_rollout_keeps_lock_and_stops_traffic_promotion(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        cloud.public_json.side_effect = [
            {"buildId": BUILD, "commit": COMMIT}, {"success": True},
            {"success": True, "data": {"checkoutAvailable": True, "packages": [{}]}},
            {"buildId": OTHER, "commit": COMMIT}
        ]
        with patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true"}):
            with self.assertRaisesRegex(RuntimeError, "App Hosting"):
                release.finish(cloud, {"buildId": BUILD, "generation": "8", "commit": COMMIT, "revision": "api-revision"})
        cloud.command.assert_not_called()
        cloud.delete_lock.assert_not_called()

    def test_backend_uses_a_valid_unique_tag_for_the_failed_release(self):
        build_id = "c4fd419b-fdb3-4d75-a0b2-2fd5c2942d61"
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": build_id}, "8")
        state = {"buildId": build_id, "generation": "8", "commit": COMMIT}
        selected_tag = None

        def command(args):
            nonlocal selected_tag
            if args[:4] == ["gcloud", "artifacts", "docker", "images"]:
                return "sha256:" + "b" * 64
            if args[:2] == ["bash", "infra/firebase/deploy-api.sh"]:
                selected_tag = next(arg.removeprefix("--tag=") for arg in args if arg.startswith("--tag="))
                # Include the hostname separator in the budget as well.
                self.assertLessEqual(len(selected_tag + "-" + release.SERVICE), 46)
                self.assertRegex(selected_tag, r"^[a-z][a-z0-9-]*[a-z0-9]$")
                self.assertIn("--no-traffic", args)
            if args[:4] == ["gcloud", "run", "services", "describe"]:
                return json.dumps({"status": {"latestReadyRevisionName": "revision-4", "traffic": [
                    {"tag": selected_tag, "revisionName": "revision-4", "url": "https://candidate.example"}
                ]}})
            return ""

        cloud.command.side_effect = command
        cloud.public_json.side_effect = [
            {"success": True}, {"success": True, "data": {"checkoutAvailable": True, "packages": [{}]}}
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(release, "STATE", pathlib.Path(directory) / "state.json"):
            release.backend(cloud, state, release.IMAGE + ":test")
            self.assertEqual(json.loads(release.STATE.read_text())["revision"], "revision-4")

    def test_traffic_tags_preserve_all_uuid_bits(self):
        # These differ only at the end; truncating a UUID would reuse a pinned tag.
        for build_id in [BUILD, BUILD[:-1] + "d", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"]:
            with self.subTest(build_id=build_id):
                tag = release.traffic_tag(build_id)
                decoded = base64.b32decode(tag[1:].upper() + "======")
                self.assertEqual(uuid.UUID(bytes=decoded), uuid.UUID(build_id))
                self.assertLessEqual(len(tag + "-" + release.SERVICE), 46)

    def test_invalid_tag_input_stops_before_database_migration(self):
        cloud = Mock()
        with self.assertRaises(ValueError):
            release.backend(cloud, {"buildId": "not-a-build-id"}, release.IMAGE + ":test")
        self.assertEqual(cloud.mock_calls, [])

    def test_verification_build_never_needs_cloud_credentials(self):
        cloud = Mock()
        self.assertIsNone(release.acquire(cloud, "false", "feature/cloud-build", COMMIT, BUILD))
        self.assertEqual(cloud.mock_calls, [])

    def test_feature_branch_cannot_deploy(self):
        cloud = Mock()
        with self.assertRaises(ValueError):
            release.acquire(cloud, "true", "feature/cloud-build", COMMIT, BUILD)
        self.assertEqual(cloud.mock_calls, [])

    def test_invalid_mode_and_commit_fail_closed(self):
        for mode, commit in [("yes", COMMIT), ("true", ""), ("true", "latest")]:
            with self.subTest(mode=mode, commit=commit), self.assertRaises(ValueError):
                release.acquire(Mock(), mode, "main", commit, BUILD)

    def test_superseded_build_does_not_lock_or_deploy(self):
        cloud = Mock()
        cloud.main_commit.return_value = "b" * 40
        self.assertIsNone(release.acquire(cloud, "true", "main", COMMIT, BUILD))
        cloud.create_lock.assert_not_called()

    def test_new_merge_while_waiting_releases_lock_and_skips(self):
        cloud = Mock()
        cloud.main_commit.side_effect = [COMMIT, "b" * 40]
        cloud.create_lock.return_value = "42"
        self.assertIsNone(release.acquire(cloud, "true", "main", COMMIT, BUILD))
        cloud.delete_lock.assert_called_once_with("42")

    def test_current_main_build_records_lock_generation(self):
        cloud = Mock()
        cloud.main_commit.return_value = COMMIT
        cloud.create_lock.return_value = "42"
        self.assertEqual(release.acquire(cloud, "true", "main", COMMIT, BUILD),
                         {"buildId": BUILD, "commit": COMMIT, "generation": "42"})

    def test_live_build_lock_is_never_stolen(self):
        cloud = Mock()
        cloud.create_lock.side_effect = release.Conflict()
        cloud.read_lock.return_value = ({"buildId": OTHER}, "9")
        cloud.build_status.return_value = "WORKING"
        with self.assertRaises(TimeoutError):
            release.ReleaseLock(cloud, sleep=lambda _: None, attempts=2).take(BUILD, COMMIT)
        cloud.delete_lock.assert_not_called()

    def test_cancelled_or_failed_build_lock_can_be_reclaimed(self):
        for status in ["CANCELLED", "FAILURE", "TIMEOUT", "SUCCESS", "EXPIRED"]:
            with self.subTest(status=status):
                cloud = Mock()
                cloud.create_lock.side_effect = [release.Conflict(), "10"]
                cloud.read_lock.return_value = ({"buildId": OTHER}, "9")
                cloud.build_status.return_value = status
                self.assertEqual(release.ReleaseLock(cloud, sleep=lambda _: None).take(BUILD, COMMIT), "10")
                cloud.delete_lock.assert_called_once_with("9")

    def test_lock_replaced_during_recovery_is_not_deleted(self):
        cloud = Mock()
        cloud.create_lock.side_effect = [release.Conflict(), release.Conflict()]
        cloud.read_lock.side_effect = [({"buildId": OTHER}, "9"), ({"buildId": OTHER}, "10")]
        cloud.build_status.side_effect = ["FAILURE", "WORKING"]
        cloud.delete_lock.side_effect = release.Conflict()
        with self.assertRaises(TimeoutError):
            release.ReleaseLock(cloud, sleep=lambda _: None, attempts=2).take(BUILD, COMMIT)
        cloud.delete_lock.assert_called_once_with("9")

    def test_lost_lock_blocks_release_steps(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": OTHER}, "9")
        with self.assertRaises(RuntimeError):
            release.assert_owner(cloud, {"buildId": BUILD, "generation": "8"})

    def test_previous_release_can_finish_between_lock_create_and_read(self):
        cloud = Mock()
        cloud.create_lock.side_effect = [release.Conflict(), "10"]
        cloud.read_lock.side_effect = release.Missing()
        self.assertEqual(release.ReleaseLock(cloud).take(BUILD, COMMIT), "10")
        cloud.delete_lock.assert_not_called()

    def test_missing_state_is_safe_noop(self):
        cloud = Mock()
        release.backend(cloud, None, "image")
        release.publish_tenant_hosting(cloud, None)
        release.finish(cloud, None)
        self.assertEqual(cloud.mock_calls, [])

    def test_tenant_publisher_requires_enabled_hosting_and_lock(self):
        cloud = Mock()
        state = {"buildId": BUILD, "generation": "8"}
        publisher = Mock()
        with patch.dict(release.sys.modules, {"tenant_publish": publisher}):
            release.publish_tenant_hosting(cloud, state)
            self.assertEqual(cloud.mock_calls, [])
            publisher.publish_tenant.assert_not_called()
            cloud.read_lock.return_value = ({"buildId": OTHER}, "8")
            with patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true"}):
                with self.assertRaisesRegex(RuntimeError, "ownership changed"):
                    release.publish_tenant_hosting(cloud, state)
            publisher.publish_tenant.assert_not_called()

    def test_tenant_publisher_failure_retains_release_lock(self):
        cloud = Mock()
        state = {"buildId": BUILD, "generation": "8"}
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        publisher = Mock()
        publisher.publish_tenant.side_effect = RuntimeError("tenant build failed")
        with patch.dict(release.sys.modules, {"tenant_publish": publisher}), patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true"}):
            with self.assertRaisesRegex(RuntimeError, "tenant build failed"):
                release.publish_tenant_hosting(cloud, state)
        publisher.publish_tenant.assert_called_once_with(cloud, state)
        cloud.delete_lock.assert_not_called()

    def test_missing_tenant_html_fails_publication_and_keeps_lock(self):
        cloud = Mock()
        state = {"buildId": BUILD, "generation": "8"}
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        cloud.check_login_page.side_effect = RuntimeError("Tenant login HTML is unavailable")
        publisher = Mock()
        with patch.dict(release.sys.modules, {"tenant_publish": publisher}), patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "true", "RELEASE_TENANT_SMOKE_SLUG": "alpha"}):
            with self.assertRaisesRegex(RuntimeError, "Tenant login HTML"):
                release.publish_tenant_hosting(cloud, state)
        publisher.publish_tenant.assert_called_once_with(cloud, state)
        cloud.check_login_page.assert_called_once_with("https://alpha." + release.TENANT_BASE + "/login?build=" + BUILD)
        cloud.delete_lock.assert_not_called()

    def test_failed_migration_prevents_backend_deployment(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        cloud.command.side_effect = ["sha256:" + "b" * 64, RuntimeError("migration failed")]
        state = {"buildId": BUILD, "generation": "8", "commit": COMMIT}
        with self.assertRaisesRegex(RuntimeError, "migration failed"):
            release.backend(cloud, state, release.IMAGE + ":test")
        self.assertEqual(cloud.command.call_count, 2)
        cloud.delete_lock.assert_not_called()

    def test_wrong_hosted_release_blocks_completion(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        cloud.public_json.return_value = {"buildId": OTHER, "commit": COMMIT}
        with self.assertRaises(RuntimeError):
            release.finish(cloud, {"buildId": BUILD, "generation": "8", "commit": COMMIT})
        cloud.command.assert_not_called()
        cloud.delete_lock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
