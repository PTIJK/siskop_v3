from datetime import datetime, timezone, timedelta
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent
with patch.object(sys, 'path', [str(ROOT), *sys.path]):
    import restore_candidate
    import promote_candidate


class FreshDestinationTests(unittest.TestCase):
    def test_manifest_rejects_other_apps_and_unverified_archives(self):
        sha = 'a' * 64
        source = {'source_project': 'lovtfdddtafuyldnkbny', 'dump_sha256': sha, 'tables': {'Tenant': {}, 'User': {}, '_prisma_migrations': {}}}
        self.assertEqual(restore_candidate.validate_manifest(source, sha), 'siskop_cutover_' + sha[:12])
        for change in [{'source_project': 'sentryx'}, {'dump_sha256': 'b' * 64}, {'tables': {}}]:
            with self.assertRaises(ValueError): restore_candidate.validate_manifest({**source, **change}, sha)

    def test_promotion_requires_final_fence_and_export_after_it(self):
        now = datetime.now(timezone.utc)
        candidate = {'archive_sha256': 'a' * 64, 'verified': True, 'database': 'siskop_cutover_' + 'a' * 12,
                     'source_created': (now - timedelta(minutes=5)).isoformat()}
        evidence = {'source_project': 'lovtfdddtafuyldnkbny', 'source_write_fenced': True, 'schedulers_paused': True,
                    'release_trigger_disabled': True, 'old_api_invocation_blocked': True, 'offhost_restore_verified': True,
                    'archive_sha256': 'a' * 64, 'frozen_utc': (now - timedelta(minutes=6)).isoformat()}
        promote_candidate.validate_evidence(evidence, candidate)
        for key in ['source_write_fenced', 'schedulers_paused', 'release_trigger_disabled', 'old_api_invocation_blocked', 'offhost_restore_verified']:
            with self.assertRaises(ValueError): promote_candidate.validate_evidence({**evidence, key: False}, candidate)
        with self.assertRaises(ValueError):
            promote_candidate.validate_evidence({**evidence, 'frozen_utc': now.isoformat()}, candidate)

    def test_sql_refuses_other_database_names_before_running_docker(self):
        from siskopctl import sql
        for name in ['sentryx', 'siskop_staging; DROP DATABASE sentryx', 'siskop_cutover_bad']:
            with self.assertRaises(ValueError): sql('SELECT 1', database=name)


if __name__ == '__main__': unittest.main()
