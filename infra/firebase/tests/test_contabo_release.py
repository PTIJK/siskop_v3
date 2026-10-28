import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).parents[1]
with patch.object(sys, 'path', [str(ROOT), *sys.path]):
    spec = importlib.util.spec_from_file_location('contabo_release', ROOT / 'contabo_release.py')
    contabo = importlib.util.module_from_spec(spec); spec.loader.exec_module(contabo)


class ContaboPublicationTests(unittest.TestCase):
    def test_failed_host_receipt_never_publishes_frontend_or_cloudrun_api(self):
        release = Mock(PROJECT='siskop-d0f8c', REGION='asia-southeast2', BUCKET='siskop-d0f8c-deployments', IMAGE='repo/api')
        release.assert_owner = Mock()
        release.Conflict = type('Conflict', (Exception,), {}); release.Missing = type('Missing', (Exception,), {})
        cloud = Mock(); cloud.command.return_value = 'sha256:' + 'b' * 64
        state = {'buildId': '12345678-1234-1234-1234-123456789abc', 'commit': 'a' * 40}
        jobs = [{'state': 'PAUSED', 'httpTarget': {'uri': contabo.ORIGIN + path}} for path in ['/api/scheduler/run-daily', '/api/scheduler/reconcile-identities']]
        cloud.request.side_effect = [*jobs, {}, {**state, 'image': 'repo/api@sha256:' + 'b' * 64, 'success': False}]
        with self.assertRaisesRegex(RuntimeError, 'deployment failed'):
            contabo.publish_backend(cloud, state, 'repo/api:build', release)
        self.assertEqual(cloud.command.call_count, 1)
        self.assertNotIn('backend', state)

    def test_bad_second_scheduler_prevents_every_pause_and_deployment_request(self):
        release = Mock(PROJECT='siskop-d0f8c', REGION='asia-southeast2', IMAGE='repo/api')
        release.assert_owner = Mock()
        cloud = Mock(); cloud.command.return_value = 'sha256:' + 'b' * 64
        cloud.request.side_effect = [
            {'state': 'ENABLED', 'httpTarget': {'uri': contabo.ORIGIN + '/api/scheduler/run-daily'}},
            {'state': 'ENABLED', 'httpTarget': {'uri': 'https://unexpected.example/job'}},
        ]
        with self.assertRaisesRegex(RuntimeError, 'scheduler target'):
            contabo.publish_backend(cloud, {'buildId': 'id', 'commit': 'a'*40}, 'repo/api:build', release)
        self.assertEqual([call.args[0] for call in cloud.request.call_args_list], ['GET', 'GET'])


if __name__ == '__main__': unittest.main()
