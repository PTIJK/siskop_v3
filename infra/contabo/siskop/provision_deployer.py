#!/usr/bin/env python3
"""Provision SISKOP's outbound-only deployment mailbox, never host access for CI."""
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
from provision_google import PROJECT, ACCOUNT, KEYS, identity, role, gcloud

BUCKET = PROJECT + '-contabo-releases'
BUILDER = 'siskop-cloud-build@' + PROJECT + '.iam.gserviceaccount.com'


def main():
    deployer = identity('siskop-contabo-deployer')
    if gcloud('storage', 'buckets', 'describe', 'gs://' + BUCKET, '--format=json', allow_missing=True) is None:
        gcloud('storage', 'buckets', 'create', 'gs://' + BUCKET, '--location=asia-southeast2', '--uniform-bucket-level-access', '--public-access-prevention')
    metadata = json.loads(gcloud('storage', 'buckets', 'describe', 'gs://' + BUCKET, '--format=json'))
    if not metadata.get('uniform_bucket_level_access') or metadata.get('public_access_prevention') != 'enforced':
        raise ValueError('Mailbox must have uniform access and public access prevention')
    for email in [BUILDER, deployer]:
        gcloud('storage', 'buckets', 'add-iam-policy-binding', 'gs://' + BUCKET, '--member=serviceAccount:' + email, '--role=roles/storage.objectViewer', '--condition=None')
    for email, prefix in [(BUILDER, 'contabo-requests/'), (deployer, 'contabo-receipts/')]:
        condition = 'expression=resource.name.startsWith("projects/_/buckets/' + BUCKET + '/objects/' + prefix + '"),title=siskop-' + prefix.rstrip('/')
        gcloud('storage', 'buckets', 'add-iam-policy-binding', 'gs://' + BUCKET, '--member=serviceAccount:' + email, '--role=roles/storage.objectCreator', '--condition=' + condition)
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as file:
        json.dump({'rule': [{'action': {'type': 'Delete'}, 'condition': {'age': 14, 'matchesPrefix': ['contabo-requests/', 'contabo-receipts/']}}]}, file); file.flush()
        gcloud('storage', 'buckets', 'update', 'gs://' + BUCKET, '--lifecycle-file=' + file.name)
    gcloud('artifacts', 'repositories', 'add-iam-policy-binding', 'siskop-staging', '--location=asia-southeast2', '--member=serviceAccount:' + deployer, '--role=roles/artifactregistry.reader', '--condition=None')
    reader = role('siskopBuildAttestation', ['cloudbuild.builds.get'])
    gcloud('projects', 'add-iam-policy-binding', PROJECT, '--member=serviceAccount:' + deployer, '--role=' + reader, '--condition=None')
    gcloud('iam', 'service-accounts', 'add-iam-policy-binding', BUILDER, '--member=serviceAccount:' + BUILDER, '--role=roles/iam.serviceAccountOpenIdTokenCreator', '--condition=None')
    payload = {'credential': json.loads((KEYS / 'siskop-contabo-deployer.json').read_text()), 'files': {}}
    directory = Path(__file__).parent
    for name in ['deploy_host.py', 'restore_initial.py', 'siskopctl.py', 'google_client.py', 'compose.yaml', 'proxy.conf', 'siskop-deploy.service', 'siskop-deploy.timer']:
        payload['files'][name] = (directory / name).read_text()
    remote = '''import sys,json,os
sys.path.insert(0,'/srv/siskop/staging')
from siskopctl import ROOT,validate_root
validate_root(); os.umask(0o077)
data=json.load(sys.stdin)
assert data['credential']['client_email']=='siskop-contabo-deployer@siskop-d0f8c.iam.gserviceaccount.com'
assert set(data['files'])=={'deploy_host.py','restore_initial.py','siskopctl.py','google_client.py','compose.yaml','proxy.conf','siskop-deploy.service','siskop-deploy.timer'}
for name,content in data['files'].items():
 target=ROOT/name
 assert not target.is_symlink()
 target.write_text(content); target.chmod(0o600)
target=ROOT/'secrets/google-deployer.json'
assert not target.is_symlink()
target.write_text(json.dumps(data['credential'])); target.chmod(0o600)
print('Dedicated SISKOP deployment files installed; no release executed')
'''
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'sentryxmonitor', 'python3 -c ' + shlex.quote(remote)], input=json.dumps(payload), capture_output=True, text=True)
    if result.returncode: raise ValueError('Private SISKOP deployment setup failed')
    print(result.stdout.strip())


if __name__ == '__main__':
    try: main()
    except Exception as error:
        raise SystemExit('SISKOP deployer provisioning stopped: ' + str(error)) from None
