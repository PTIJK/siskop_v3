import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("release", pathlib.Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(SPEC)
with patch.object(sys, "path", [str(pathlib.Path(__file__).parents[1]), *sys.path]):
    SPEC.loader.exec_module(release)
ORIGIN = "https://siskop-staging-api-example.a.run.app"
REVISION = "api-revision"


class SchedulerActivationTests(unittest.TestCase):
    def test_finish_promotes_traffic_before_activation_and_keeps_lock_on_failure(self):
        for selection in ["false", "true"]:
            with self.subTest(selection=selection), patch.dict(release.os.environ, {
                "RELEASE_TENANT_HOSTING": "false",
                "RELEASE_TENANT_LOGIN_SELECTION_ENABLED": selection,
            }):
                cloud = Mock()
                cloud.read_lock.return_value = ({"buildId": "build"}, "8")
                responses = [
                    {"buildId": "build", "commit": "commit"}, {"success": True},
                    {"success": True, "data": {"checkoutAvailable": True, "packages": [{}]}},
                ]
                if selection == "true":
                    responses.append({"success": True, "data": {"enabled": True, "centralUrl": release.ORIGIN + "/login"}})
                cloud.public_json.side_effect = responses

                def activate(*_):
                    self.assertIn("--to-revisions=api-revision=100", cloud.command.call_args.args[0])
                    raise RuntimeError("activation failed")

                with patch.object(release, "activate_schedulers", side_effect=activate):
                    with self.assertRaisesRegex(RuntimeError, "activation failed"):
                        release.finish(cloud, {"buildId": "build", "commit": "commit", "revision": REVISION, "generation": "8"})
                cloud.delete_lock.assert_not_called()

    def cloud(self):
        cloud = Mock()
        cloud.command.return_value = ORIGIN
        specs = [{"id": "siskop-daily-scheduler", "path": "/api/scheduler/run-daily", "schedule": "5 0 * * *"},
                 {"id": "siskop-identity-recovery", "path": "/api/scheduler/reconcile-identities", "schedule": "*/15 * * * *"}]
        self.jobs = [{"name": f"projects/{release.PROJECT}/locations/{release.REGION}/jobs/" + spec["id"], "state": "PAUSED",
                      "schedule": spec["schedule"], "timeZone": "Etc/UTC", "httpTarget": {
                          "uri": ORIGIN + spec["path"], "httpMethod": "POST", "headers": {"x-scheduler-token": "test-only"},
                          "oidcToken": {"audience": ORIGIN, "serviceAccountEmail": f"siskop-scheduler-invoker@{release.PROJECT}.iam.gserviceaccount.com"}
                      }} for spec in specs]
        cloud.request.side_effect = [*self.jobs, {}, {}]
        cloud.scheduler_status.return_value = {"success": True, "data": {"version": 1, "revision": REVISION, "daily": True, "identityRecovery": True}}
        return cloud

    def test_activates_both_only_after_read_only_readiness_checks(self):
        cloud = self.cloud()
        release.activate_schedulers(cloud, {"revision": REVISION})
        self.assertEqual(cloud.scheduler_status.call_count, 2)
        calls = cloud.request.call_args_list
        self.assertEqual([call.args[0] for call in calls], ["GET", "GET", "POST", "POST"])
        self.assertTrue(all(call.args[1].endswith(":resume") for call in calls[2:]))

    def test_old_revision_or_disabled_recovery_prevents_all_activation(self):
        for change in [{"revision": "old"}, {"identityRecovery": False}, {"version": 0}, {"daily": False}]:
            with self.subTest(change=change):
                cloud = self.cloud()
                cloud.scheduler_status.return_value["data"].update(change)
                with self.assertRaises(RuntimeError):
                    release.activate_schedulers(cloud, {"revision": REVISION})
                self.assertTrue(all(call.args[0] == "GET" for call in cloud.request.call_args_list))

    def test_wrong_target_never_receives_secret_and_never_resumes_any_job(self):
        cloud = self.cloud()
        self.jobs[0]["httpTarget"]["uri"] = "https://attacker.example/api/scheduler/run-daily"
        with self.assertRaises(RuntimeError):
            release.activate_schedulers(cloud, {"revision": REVISION})
        cloud.scheduler_status.assert_not_called()
        self.assertTrue(all(call.args[0] == "GET" for call in cloud.request.call_args_list))

    def test_bad_second_job_leaves_first_paused(self):
        cloud = self.cloud()
        self.jobs[1]["httpTarget"]["headers"] = {}
        with self.assertRaises(RuntimeError):
            release.activate_schedulers(cloud, {"revision": REVISION})
        self.assertTrue(all(call.args[0] == "GET" for call in cloud.request.call_args_list))

    def test_repeated_release_does_not_resume_already_enabled_jobs(self):
        cloud = self.cloud()
        for job in self.jobs:
            job["state"] = "ENABLED"
        release.activate_schedulers(cloud, {"revision": REVISION})
        self.assertTrue(all(call.args[0] == "GET" for call in cloud.request.call_args_list))


if __name__ == "__main__":
    unittest.main()
