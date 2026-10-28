import copy
from datetime import datetime, timezone, timedelta
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent
with patch.object(sys, 'path', [str(ROOT), *sys.path]):
    spec = importlib.util.spec_from_file_location('siskop_deploy', ROOT / 'deploy_host.py')
    deploy = importlib.util.module_from_spec(spec); spec.loader.exec_module(deploy)


class DeploymentBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.data = {'buildId': '12345678-1234-1234-1234-123456789abc', 'commit': 'a' * 40, 'image': deploy.IMAGE + '@sha256:' + 'b' * 64}
        self.build = {'id': self.data['buildId'], 'buildTriggerId': deploy.TRIGGER, 'serviceAccount': deploy.BUILDER,
            'status': 'WORKING', 'createTime': datetime.now(timezone.utc).isoformat(),
            'substitutions': {'BRANCH_NAME': 'main', 'COMMIT_SHA': self.data['commit'], '_DEPLOY': 'true', '_BACKEND': 'contabo'},
            'steps': [{'id': step, 'status': 'SUCCESS'} for step in ['verify-and-build-frontend', 'push-backend']]}

    def test_requires_tested_main_trigger_and_exact_builder(self):
        deploy.validate_request(self.data, self.build)
        for key, value in [('id', 'other'), ('buildTriggerId', 'manual'), ('serviceAccount', 'other'), ('status', 'CANCELLED')]:
            with self.subTest(key=key):
                build = {**self.build, key: value}
                with self.assertRaises(ValueError): deploy.validate_request(self.data, build)
        for key, value in [('BRANCH_NAME', 'feature/test'), ('COMMIT_SHA', 'c' * 40), ('_DEPLOY', 'false'), ('_BACKEND', 'cloudrun')]:
            build = copy.deepcopy(self.build); build['substitutions'][key] = value
            with self.assertRaises(ValueError): deploy.validate_request(self.data, build)

    def test_rejects_failed_checks_and_stale_requests(self):
        build = copy.deepcopy(self.build); build['steps'][0]['status'] = 'FAILURE'
        with self.assertRaises(ValueError): deploy.validate_request(self.data, build)
        build = {**self.build, 'createTime': (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()}
        with self.assertRaises(ValueError): deploy.validate_request(self.data, build)

    def test_rejects_other_images_mutable_tags_and_commands(self):
        for value in ['sentryx/api@sha256:' + 'b' * 64, deploy.IMAGE + ':latest', deploy.IMAGE + '@sha256:bad']:
            with self.assertRaises(ValueError): deploy.validate_request({**self.data, 'image': value}, self.build)
        with self.assertRaises(ValueError): deploy.validate_request({**self.data, 'command': 'docker prune'}, self.build)

    def test_mailbox_never_operates_before_cutover(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'ROOT', Path(directory)), \
             patch.object(deploy, 'validate_root'), patch.object(deploy, 'validate_container'), patch.object(deploy, 'session') as credentials:
            deploy.main()
            credentials.assert_not_called()


if __name__ == '__main__': unittest.main()
