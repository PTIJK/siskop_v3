#!/usr/bin/env python3
"""Fence only the SISKOP source after backups, trigger/jobs and old API are held."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
from urllib.error import HTTPError
from urllib.request import urlopen
from backup_source import source_environment
from provision_google import gcloud

PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
TRIGGER = '8346644b-e829-4692-8226-fad4c3c5ce28'


def source_query(env, query, expected_error=None):
    result = subprocess.run([PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-c', query], env=env, capture_output=True, text=True)
    if expected_error:
        if result.returncode == 0 or expected_error not in result.stderr:
            raise ValueError('Source did not reject writes as expected')
        return ''
    if result.returncode: raise ValueError('Source fencing query failed; private diagnostics required')
    return result.stdout.strip()


def assert_controls():
    trigger = json.loads(gcloud('builds', 'triggers', 'describe', TRIGGER, '--region=asia-southeast2', '--format=json'))
    if trigger.get('disabled') is not True: raise ValueError('Release trigger must be disabled before fencing')
    for name in ['siskop-daily-scheduler', 'siskop-identity-recovery']:
        job = json.loads(gcloud('scheduler', 'jobs', 'describe', name, '--location=asia-southeast2', '--format=json'))
        if job.get('state') != 'PAUSED': raise ValueError('Both SISKOP schedulers must be paused')
    policy = json.loads(gcloud('run', 'services', 'get-iam-policy', 'siskop-staging-api', '--region=asia-southeast2', '--format=json'))
    if any(binding.get('role') == 'roles/run.invoker' and set(binding.get('members', [])) & {'allUsers', 'allAuthenticatedUsers'} for binding in policy.get('bindings', [])):
        raise ValueError('Old SISKOP API still allows public invocation')
    origin = gcloud('run', 'services', 'describe', 'siskop-staging-api', '--region=asia-southeast2', '--format=value(status.url)').strip()
    if not origin.startswith('https://siskop-staging-api-') or not origin.endswith('.a.run.app'):
        raise ValueError('Unexpected old SISKOP API origin')
    try:
        with urlopen(origin + '/api/health', timeout=20): pass
    except HTTPError as error:
        if error.code not in {401, 403}: raise ValueError('Old API block must be verified') from None
    else: raise ValueError('Old SISKOP API is still publicly reachable')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-env', required=True)
    parser.add_argument('--verified-backup', required=True)
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    evidence = Path(args.evidence).resolve()
    workspace = Path(__file__).resolve().parents[3]
    private_root = (workspace / 'apps/backend/scripts/data/contabo-migration').resolve()
    if evidence.parent != private_root or evidence.exists() or evidence.is_symlink():
        raise ValueError('Use a new SISKOP private evidence filename')
    backup = Path(args.verified_backup).resolve()
    if private_root not in backup.parents: raise ValueError('Unexpected SISKOP backup location')
    verified = json.loads((backup / 'restore-verification.json').read_text())
    if verified.get('verified') is not True or verified.get('source_modified') is not False:
        raise ValueError('A clean SISKOP restore must be verified before source changes')
    env = source_environment(args.source_env)
    assert_controls()
    before = json.loads(source_query(env, "SELECT json_build_object('role',current_user,'database',current_database(),'read_only',current_setting('default_transaction_read_only'),'database_role_settings',(SELECT setconfig FROM pg_db_role_setting WHERE setrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())));"))
    if before['role'] != 'postgres' or before['database'] != 'postgres' or before['read_only'] != 'off':
        raise ValueError('Source identity or existing read-only state needs review')
    report = {'source_project': 'lovtfdddtafuyldnkbny', 'before': before, 'prechange_backup_sha256': verified['dump_sha256'],
              'release_trigger_disabled': True, 'schedulers_paused': True, 'old_api_invocation_blocked': True,
              'source_write_fenced': False}
    evidence.write_text(json.dumps(report, indent=2)); evidence.chmod(0o600)
    # Commit the role default first. Terminating that session in the same SQL
    # message would roll back the change, leaving old pooled writers unfenced.
    source_query(env, 'ALTER ROLE postgres IN DATABASE postgres SET default_transaction_read_only=on;')
    terminated = subprocess.run([PSQL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND usename='postgres' AND pid<>pg_backend_pid(); SELECT pg_terminate_backend(pg_backend_pid());"],
        env=env, capture_output=True, text=True)
    # The intentionally terminated operator connection normally exits nonzero.
    # A fresh connection and a negative write test provide the actual proof.
    if source_query(env, 'SHOW default_transaction_read_only;') != 'on':
        raise ValueError('Source role default did not reach a fresh pooled connection')
    source_query(env, 'UPDATE public."Tenant" SET name=name WHERE false;', expected_error='25006')
    report.update(source_write_fenced=True, frozen_utc=datetime.now(timezone.utc).isoformat(),
                  fence='postgres database-role default read-only; old sessions terminated; write rejection verified')
    evidence.write_text(json.dumps(report, indent=2))
    print(json.dumps({key: report[key] for key in ['source_project', 'source_write_fenced', 'frozen_utc']}))


if __name__ == '__main__':
    try: main()
    except Exception as error: raise SystemExit('SISKOP source fence stopped: ' + str(error)) from None
