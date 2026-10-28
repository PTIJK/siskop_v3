import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class SafetyTests(unittest.TestCase):
    def test_certificate_cleanup_preserves_other_validation_values(self):
        hook = module('dns_hook')
        original = {'name': hook.RECORD, 'type': 'TXT', 'ttl': 60, 'rrdatas': ['"our-token"', '"another-token"']}
        result = hook.change_body(original, 'our-token', cleanup=True)
        self.assertEqual(result['additions'][0]['rrdatas'], ['"another-token"'])
        self.assertEqual(original['rrdatas'], ['"our-token"', '"another-token"'])
        self.assertIsNone(hook.change_body(original, 'absent-token', cleanup=True))

    def test_certificate_hook_does_not_accept_other_domains(self):
        hook = module('dns_hook')
        with patch('sys.argv', ['dns_hook.py', 'auth']), patch.dict('os.environ', {'CERTBOT_DOMAIN': 'sentryxmonitor.com'}):
            with patch.object(hook, 'session') as session:
                with self.assertRaises(ValueError):
                    hook.main()
                session.assert_not_called()

    def test_wrong_host_or_directory_is_rejected_before_file_access(self):
        ctl = module('siskopctl')
        for directory, hostname in [(Path('/srv/sentryx'), 'vmi3303548'), (ctl.ROOT, 'another-host')]:
            with self.assertRaises(ValueError):
                ctl.validate_root(directory, hostname)

    def test_sentryx_container_is_never_an_acceptable_target(self):
        ctl = module('siskopctl')
        data = {'Config': {'Labels': {'com.docker.compose.project': 'sentryx'}}}
        with patch.object(ctl, 'command', return_value=json.dumps([data]).encode()):
            with self.assertRaisesRegex(ValueError, 'non-SISKOP'):
                ctl.validate_container()

    def test_public_port_or_shared_network_is_rejected(self):
        ctl = module('siskopctl')
        data = {
            'Config': {'Labels': {'com.docker.compose.project': 'siskop-staging', 'com.siskop.application': 'siskop'}},
            'Mounts': [
                {'Type': 'bind', 'Destination': '/var/lib/postgresql/data', 'Source': '/srv/siskop/staging/postgres'},
                {'Type': 'bind', 'Destination': '/run/secrets/bootstrap-password', 'Source': '/srv/siskop/staging/secrets/bootstrap-password'}],
            'HostConfig': {'PortBindings': {'5432/tcp': [{'HostPort': '5432'}]}},
            'NetworkSettings': {'Networks': {'siskop-staging-database': {}}}}
        with patch.object(ctl, 'command', return_value=json.dumps([data]).encode()):
            with self.assertRaisesRegex(ValueError, 'private'):
                ctl.validate_container()
        data['HostConfig']['PortBindings'] = {}
        data['NetworkSettings']['Networks']['sentryx_default'] = {}
        with patch.object(ctl, 'command', return_value=json.dumps([data]).encode()):
            with self.assertRaisesRegex(ValueError, 'private'):
                ctl.validate_container()

    def test_backup_rejects_other_database_credentials(self):
        backup = module('backup_source')
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / 'source.env'
            for url in ['postgresql://postgres:secret@localhost:5432/sentryxmonitor',
                        'postgresql://postgres.other:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres']:
                env.write_text('DATABASE_URL=' + url)
                with self.assertRaises(ValueError):
                    backup.source_environment(env)


if __name__ == '__main__':
    unittest.main()
