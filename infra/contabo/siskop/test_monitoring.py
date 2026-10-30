import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

with patch.object(sys, 'path', [str(Path(__file__).parent), *sys.path]):
    import provision_monitoring as monitoring


class MonitoringTests(unittest.TestCase):
    def test_updates_only_stale_probe_path_and_matcher(self):
        uptime = {'name': 'projects/' + monitoring.PROJECT + '/uptimeCheckConfigs/check',
                  'httpCheck': {'path': '/api/onboarding/packages', 'useSsl': True},
                  'contentMatchers': [{'content': '"checkoutAvailable":true', 'matcher': 'CONTAINS_STRING'}]}
        before = copy.deepcopy(uptime)
        with patch.object(monitoring, 'request', return_value={'updated': True}) as request:
            self.assertEqual(monitoring.update_uptime_readiness(uptime), {'updated': True})
            method, path, body = request.call_args.args
            self.assertEqual(method, 'PATCH')
            self.assertEqual(path, 'uptimeCheckConfigs/check?updateMask=httpCheck.path,contentMatchers')
            self.assertEqual(body['httpCheck'], {'path': '/api/public/pricing'})
            self.assertEqual(body['contentMatchers'], [{'content': '"success":true', 'matcher': 'CONTAINS_STRING'}])
        self.assertEqual(uptime, before)
        uptime['httpCheck']['path'] = '/api/public/pricing'
        uptime['contentMatchers'] = body['contentMatchers']
        with patch.object(monitoring, 'request') as request:
            self.assertIs(monitoring.update_uptime_readiness(uptime), uptime)
            request.assert_not_called()
