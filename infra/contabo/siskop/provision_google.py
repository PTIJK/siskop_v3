#!/usr/bin/env python3
"""Create only the dedicated SISKOP Google identities and scoped permissions."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

PROJECT = 'siskop-d0f8c'
ACCOUNT = 'yudith.octo@gmail.com'
KEYS = Path(__file__).resolve().parents[3] / 'apps/backend/scripts/data/contabo-migration/keys'


def gcloud(*args, allow_missing=False):
    result = subprocess.run(['gcloud', *args, f'--project={PROJECT}', f'--account={ACCOUNT}', '--quiet'], capture_output=True, text=True)
    if result.returncode:
        if allow_missing and ('NOT_FOUND' in result.stderr or 'does not exist' in result.stderr or 'not found: 404' in result.stderr):
            return None
        # These operations pass filenames/identity names, never key material.
        raise RuntimeError('Google setup operation failed: ' + ' '.join(args[:3]) + '; ' + result.stderr[-1000:])
    return result.stdout


def identity(name):
    email = f'{name}@{PROJECT}.iam.gserviceaccount.com'
    if gcloud('iam', 'service-accounts', 'describe', email, '--format=json', allow_missing=True) is None:
        gcloud('iam', 'service-accounts', 'create', name, f'--display-name={name}')
    path = KEYS / (name + '.json')
    if path.exists() and path.stat().st_size == 0 and not path.is_symlink():
        # gcloud creates the output file before IAM resolves a new account.
        # An empty file is a failed-create artifact, never a usable credential.
        path.unlink()
    if not path.exists():
        # IAM's projects/- lookup can lag immediately after account creation.
        for delay in [0, 3, 8, 15, 30]:
            time.sleep(delay)
            if gcloud('iam', 'service-accounts', 'keys', 'create', str(path), '--iam-account=' + email, allow_missing=True) is not None:
                break
            if path.exists() and path.stat().st_size == 0:
                path.unlink()
        else:
            raise ValueError('New SISKOP identity has not propagated; no permissions widened')
        path.chmod(0o600)
    data = json.loads(path.read_text())
    if data.get('project_id') != PROJECT or data.get('client_email') != email or path.stat().st_mode & 0o077:
        raise ValueError('Unexpected credential identity or permissions')
    return email


def role(name, permissions):
    spec = gcloud('iam', 'roles', 'describe', name, '--format=json', allow_missing=True)
    if spec is None:
        gcloud('iam', 'roles', 'create', name, '--title=' + name, '--permissions=' + ','.join(permissions), '--stage=GA')
    elif set(json.loads(spec)['includedPermissions']) != set(permissions):
        raise ValueError('Existing role permissions differ; manual review required')
    return f'projects/{PROJECT}/roles/{name}'


def main():
    os.umask(0o077)
    KEYS.mkdir(parents=True, exist_ok=True)
    runtime = identity('siskop-contabo-runtime')
    backup = identity('siskop-contabo-backup')
    acme = identity('siskop-contabo-acme')
    auth_role = role('siskopContaboAuth', ['firebaseauth.users.create', 'firebaseauth.users.delete', 'firebaseauth.users.get'])
    gcloud('projects', 'add-iam-policy-binding', PROJECT, '--member=serviceAccount:' + runtime, '--role=' + auth_role, '--condition=None')
    gcloud('storage', 'buckets', 'add-iam-policy-binding', 'gs://siskop-d0f8c-staging-uploads', '--member=serviceAccount:' + runtime, '--role=roles/storage.objectUser', '--condition=None')
    gcloud('storage', 'buckets', 'add-iam-policy-binding', 'gs://siskop-d0f8c-db-backups', '--member=serviceAccount:' + backup, '--role=roles/storage.objectCreator', '--condition=None')
    dns_role = role('siskopAcmeRecords', ['dns.changes.create', 'dns.changes.get', 'dns.resourceRecordSets.create', 'dns.resourceRecordSets.delete', 'dns.resourceRecordSets.list', 'dns.resourceRecordSets.update'])
    policy = json.loads(gcloud('dns', 'managed-zones', 'get-iam-policy', 'siskop-api-acme', '--format=json'))
    bindings = policy.setdefault('bindings', [])
    expected = {'role': dns_role, 'members': ['serviceAccount:' + acme]}
    if any(b['role'] == dns_role and b != expected for b in bindings):
        raise ValueError('Existing certificate-zone binding differs; review required')
    if expected not in bindings:
        bindings.append(expected)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as document:
            json.dump(policy, document); document.flush()
            gcloud('dns', 'managed-zones', 'set-iam-policy', 'siskop-api-acme', '--policy-file=' + document.name)
    print(json.dumps({'runtime': runtime, 'backup': backup, 'certificate': acme, 'private_keys': 'local ignored files; contents withheld', 'sentryx_access': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP Google provisioning stopped: {error}') from None
