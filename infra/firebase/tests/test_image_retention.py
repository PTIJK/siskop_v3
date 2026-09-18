import importlib.util
import json
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("release", pathlib.Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(SPEC)
with patch.object(sys, "path", [str(pathlib.Path(__file__).parents[1]), *sys.path]):
    SPEC.loader.exec_module(release)

BUILD = "12345678-1234-1234-1234-123456789abc"
OLD = "sha256:" + "a" * 64
NEW = "sha256:" + "b" * 64
RESOURCE = f"projects/{release.PROJECT}/locations/{release.REGION}/repositories/siskop-staging/packages/api"


class ImageRetentionTests(unittest.TestCase):
    def cloud(self, tags):
        cloud = Mock()
        def command(args):
            if args[4] == "list":
                return json.dumps([{"tag": RESOURCE + "/tags/" + tag,
                                    "version": RESOURCE + "/versions/" + digest}
                                   for tag, digest in tags.items()])
            if args[4] == "add":
                tags[args[6].split(":")[-1]] = args[5].split("@")[-1]
            if args[4] == "delete":
                del tags[args[5].split(":")[-1]]
            return ""
        cloud.command.side_effect = command
        return cloud

    def test_candidate_is_protected_without_moving_live_or_rollback(self):
        tags = {"retain-live": OLD, "retain-rollback": "sha256:" + "c" * 64}
        release.protect_candidate_image(self.cloud(tags), release.IMAGE + "@" + NEW, BUILD)
        self.assertEqual(tags["retain-live"], OLD)
        self.assertEqual(tags["retain-rollback"], "sha256:" + "c" * 64)
        self.assertEqual(tags["retain-pending-" + BUILD], NEW)

    def test_success_keeps_previous_live_and_releases_only_pending_pins(self):
        tags = {"retain-live": OLD, "retain-pending-" + BUILD: NEW,
                "retain-manual-investigation": OLD, "cache-runtime": NEW, BUILD: NEW}
        cloud = self.cloud(tags)
        release.finish_image_retention(cloud, release.IMAGE + "@" + NEW)
        self.assertEqual(tags, {"retain-live": NEW, "retain-rollback": OLD,
                               "retain-manual-investigation": OLD, "cache-runtime": NEW, BUILD: NEW})
        # Retrying finish must not replace the rollback image with the new one.
        release.finish_image_retention(cloud, release.IMAGE + "@" + NEW)
        self.assertEqual(tags["retain-rollback"], OLD)

    def test_failed_rotation_keeps_pending_and_old_live_images_protected(self):
        tags = {"retain-live": OLD, "retain-pending-" + BUILD: NEW}
        cloud = self.cloud(tags)
        command = cloud.command.side_effect
        def fail(args):
            if args[4] == "add" and args[6].endswith(":retain-live"):
                raise RuntimeError("registry unavailable")
            return command(args)
        cloud.command.side_effect = fail
        with self.assertRaisesRegex(RuntimeError, "registry unavailable"):
            release.finish_image_retention(cloud, release.IMAGE + "@" + NEW)
        self.assertEqual(tags["retain-live"], OLD)
        self.assertEqual(tags["retain-pending-" + BUILD], NEW)
        self.assertEqual(tags["retain-rollback"], OLD)
        cloud.command.side_effect = command
        release.finish_image_retention(cloud, release.IMAGE + "@" + NEW)
        self.assertEqual(tags, {"retain-live": NEW, "retain-rollback": OLD})

    def test_invalid_image_or_build_id_cannot_change_tags(self):
        cloud = Mock()
        for image, build in [("other/image@" + NEW, BUILD), (release.IMAGE + ":latest", BUILD),
                             (release.IMAGE + "@" + NEW, "not-a-build")]:
            with self.subTest(image=image, build=build), self.assertRaises(ValueError):
                release.protect_candidate_image(cloud, image, build)
        cloud.command.assert_not_called()

    def test_invalid_live_digest_fails_before_rotating_or_unpinning(self):
        tags = {"retain-live": "bad", "retain-pending-" + BUILD: NEW}
        cloud = self.cloud(tags)
        with self.assertRaises(ValueError):
            release.finish_image_retention(cloud, release.IMAGE + "@" + NEW)
        self.assertEqual(cloud.command.call_count, 1)

    def test_only_coordinated_release_retires_older_partial_rollouts(self):
        other = "abcdefab-1234-1234-1234-123456789abc"
        tags = {"retain-live": OLD, "retain-pending-" + BUILD: NEW,
                "retain-pending-" + other: "sha256:" + "c" * 64}
        cloud = self.cloud(tags)
        release.finish_image_retention(cloud, release.IMAGE + "@" + NEW)
        self.assertIn("retain-pending-" + other, tags)
        release.finish_image_retention(cloud, release.IMAGE + "@" + NEW, coordinated=True)
        self.assertNotIn("retain-pending-" + other, tags)
        self.assertEqual(tags["retain-rollback"], OLD)

    def test_pin_failure_stops_before_migrating_or_deploying(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        cloud.command.side_effect = [NEW, RuntimeError("cannot protect image")]
        with patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "false"}):
            with self.assertRaisesRegex(RuntimeError, "cannot protect image"):
                release.backend(cloud, {"buildId": BUILD, "generation": "8"}, release.IMAGE + ":" + BUILD)
        self.assertEqual(cloud.command.call_count, 2)
        self.assertTrue(all(call.args[0][1] == "artifacts" for call in cloud.command.call_args_list))

    def test_retention_failure_after_publication_does_not_unlock_release(self):
        cloud = Mock()
        cloud.read_lock.return_value = ({"buildId": BUILD}, "8")
        cloud.public_json.side_effect = [
            {"buildId": BUILD, "commit": "commit"}, {"success": True},
            {"success": True, "data": {"checkoutAvailable": True, "packages": [{}]}}]
        with patch.dict(release.os.environ, {"RELEASE_TENANT_HOSTING": "false", "RELEASE_TENANT_LOGIN_SELECTION_ENABLED": "false"}), \
             patch.object(release, "activate_schedulers") as activate, \
             patch.object(release, "finish_image_retention", side_effect=RuntimeError("retention failed")):
            with self.assertRaisesRegex(RuntimeError, "retention failed"):
                release.finish(cloud, {"buildId": BUILD, "generation": "8", "commit": "commit",
                                       "image": release.IMAGE + "@" + NEW, "revision": "revision"})
        activate.assert_called_once()
        cloud.delete_lock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
