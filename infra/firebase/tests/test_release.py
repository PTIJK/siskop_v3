import importlib.util
import pathlib
import unittest
from unittest.mock import Mock

SPEC = importlib.util.spec_from_file_location("release", pathlib.Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

BUILD = "12345678-1234-1234-1234-123456789abc"
OTHER = "abcdefab-1234-1234-1234-123456789abc"
COMMIT = "a" * 40


class ReleaseSafetyTests(unittest.TestCase):
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
        release.finish(cloud, None)
        self.assertEqual(cloud.mock_calls, [])

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
