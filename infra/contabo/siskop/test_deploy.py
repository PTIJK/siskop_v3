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
    def test_readiness_requires_published_pricing_v2_catalog(self):
        import io
        import json
        root = unittest.mock.MagicMock()
        (root / 'secrets/api.env').read_text.return_value = 'CENTRAL_GATEWAY_SECRET=test-only'
        with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'command', return_value=self.data['buildId'].encode()), patch.object(deploy, 'urlopen') as request:
            for catalog in [{'version': 1, 'packages': [{}]}, {'packages': [{}]}, {'version': 1, 'packages': []}]:
                request.return_value.__enter__.return_value = io.BytesIO(json.dumps({'success': True, 'data': catalog}).encode())
                if catalog.get('version') and catalog['packages']:
                    deploy.health(self.data['buildId'], 'siskop-api-staging', 18081)
                else:
                    with self.assertRaisesRegex(ValueError, 'database readiness'):
                        deploy.health(self.data['buildId'], 'siskop-api-staging', 18081)
                self.assertEqual(request.call_args.args[0].full_url, 'http://127.0.0.1:18081/api/public/pricing')

    def test_handoff_checks_candidate_before_switch_and_drains_before_replacement(self):
        events = []
        with patch.object(deploy, 'compose', side_effect=lambda *a: events.append(('compose', a))), \
             patch.object(deploy, 'wait_ready', side_effect=lambda *a: events.append(('ready', a))), \
             patch.object(deploy, 'switch_api', side_effect=lambda *a: events.append(('switch', a))), \
             patch.object(deploy, 'remove_candidate', side_effect=lambda: events.append(('cleanup', ()))):
            deploy.handoff('old', 'SISKOP_RELEASE_ID=old', 'new')
        self.assertEqual([e[0] for e in events], ['compose', 'ready', 'switch', 'compose', 'ready', 'switch', 'cleanup'])
        self.assertEqual(events[1][1], ('new', 'siskop-api-candidate', 18082))
        self.assertEqual(events[2][1], ('siskop-api-candidate', 18082))
        self.assertEqual(events[5][1], ('siskop-api-staging', 18081))
        self.assertIn('127.0.0.1:18082:8080', events[0][1])

    def test_failed_primary_rolls_back_before_removing_candidate(self):
        events = []
        def ready(revision, container, port):
            events.append(('ready', revision))
            if container == 'siskop-api-staging' and revision == 'new': raise ValueError('unhealthy')
        with patch.object(deploy, 'compose'), patch.object(deploy, 'wait_ready', side_effect=ready), \
             patch.object(deploy, 'switch_api', side_effect=lambda *a: events.append(('switch', a[0]))), \
             patch.object(deploy, 'write_private'), \
             patch.object(deploy, 'remove_candidate', side_effect=lambda: events.append(('cleanup', None))):
            with self.assertRaisesRegex(ValueError, 'unhealthy'):
                deploy.handoff('old', 'SISKOP_RELEASE_ID=old', 'new')
        self.assertEqual(events[-3:], [('ready', 'old'), ('switch', 'siskop-api-staging'), ('cleanup', None)])

    def test_failed_recovery_keeps_serving_candidate(self):
        def ready(revision, container, port):
            if container == 'siskop-api-staging': raise ValueError('unhealthy')
        with patch.object(deploy, 'compose'), patch.object(deploy, 'wait_ready', side_effect=ready), \
             patch.object(deploy, 'switch_api'), patch.object(deploy, 'write_private'), \
             patch.object(deploy, 'remove_candidate') as cleanup:
            with self.assertRaisesRegex(ValueError, 'unhealthy'):
                deploy.handoff('old', 'SISKOP_RELEASE_ID=old', 'new')
            cleanup.assert_not_called()

    def test_proxy_switch_waits_for_old_workers_and_preserves_failed_config(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'proxy-state').mkdir()
            target = root / 'proxy-state/upstream.conf'; target.write_text('old upstream')
            labels = {'com.siskop.application': 'siskop', 'com.docker.compose.project': deploy.PROJECT}
            api = {'Config': {'Labels': labels}, 'NetworkSettings': {'Networks': {'siskop-staging-egress': {'IPAddress': '172.30.1.3'}}}}
            proxy = {'Config': {'Labels': labels}, 'Mounts': [{'Type': 'bind', 'Destination': '/etc/siskop-state', 'Source': str(root / 'proxy-state')}]}
            calls = []
            def command(args):
                calls.append(args)
                if args[1] == 'inspect': return json.dumps([proxy if args[2] == 'siskop-proxy-staging' else api]).encode()
                return b''
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'command', side_effect=command), \
                 patch.object(deploy, 'proxy_workers', side_effect=[{'10'}, {'10'}, {'11'}]), \
                 patch.object(deploy.time, 'sleep') as sleep:
                deploy.switch_api('siskop-api-candidate', 18082)
                sleep.assert_called_once_with(1)
            self.assertEqual(target.read_text(), 'set $siskop_upstream 172.30.1.3:8080;\n')
            self.assertEqual(json.loads((root / 'active-api.json').read_text())['container'], 'siskop-api-candidate')
            def fail_config(args):
                if args[-1] == '-t': raise RuntimeError('bad config')
                return command(args)
            before = target.read_text()
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'command', side_effect=fail_config):
                with self.assertRaisesRegex(RuntimeError, 'bad config'):
                    deploy.switch_api('siskop-api-staging', 18081)
            self.assertEqual(target.read_text(), before)

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
