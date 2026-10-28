import importlib.util
from pathlib import Path
import sys
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).parent
with patch.object(sys, 'path', [str(ROOT), *sys.path]):
    import source_fence
    import health_host


class SourceFenceBoundaryTests(unittest.TestCase):
    def cloud(self, *args):
        if args[:3] == ('builds', 'triggers', 'describe'): return json.dumps({'disabled': True})
        if args[:3] == ('scheduler', 'jobs', 'describe'): return json.dumps({'state': 'PAUSED'})
        if args[:3] == ('run', 'services', 'get-iam-policy'): return json.dumps({'bindings': []})
        if args[:3] == ('run', 'services', 'describe'): return 'https://siskop-staging-api-example.a.run.app'
        raise AssertionError('Unexpected control-plane operation')

    def test_fence_requires_paused_jobs_and_disabled_trigger(self):
        for resource in ['builds', 'scheduler']:
            def cloud(*args):
                if args[0] == resource: return json.dumps({'disabled': False} if resource == 'builds' else {'state': 'ENABLED'})
                return self.cloud(*args)
            with patch.object(source_fence, 'gcloud', side_effect=cloud), patch.object(source_fence, 'urlopen') as network:
                with self.assertRaises(ValueError): source_fence.assert_controls()
                network.assert_not_called()

    def test_fence_requires_public_old_api_block(self):
        def cloud(*args):
            if args[:3] == ('run', 'services', 'get-iam-policy'):
                return json.dumps({'bindings': [{'role': 'roles/run.invoker', 'members': ['allUsers']}]})
            return self.cloud(*args)
        with patch.object(source_fence, 'gcloud', side_effect=cloud), patch.object(source_fence, 'urlopen') as network:
            with self.assertRaises(ValueError): source_fence.assert_controls()
            network.assert_not_called()
        with patch.object(source_fence, 'gcloud', side_effect=self.cloud), patch.object(source_fence, 'urlopen'):
            with self.assertRaises(ValueError): source_fence.assert_controls()
        with patch.object(source_fence, 'gcloud', side_effect=self.cloud), patch.object(source_fence, 'urlopen', side_effect=HTTPError('https://example.invalid',403,'denied',{},None)):
            source_fence.assert_controls()

    def test_rehearsal_backup_never_satisfies_authoritative_freshness(self):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        self.assertEqual(health_host.backup_age({'authoritative': False, 'completed_utc': now.isoformat()}, now), 86400)
        self.assertEqual(health_host.backup_age({'authoritative': True, 'completed_utc': now.isoformat()}, now), 0)


if __name__ == '__main__': unittest.main()
