#!/usr/bin/env python3
"""Copy pinned SISKOP settings to its private VPS runtime; never print values."""
import json
from pathlib import Path
import secrets
import shlex
import subprocess

PROJECT = 'siskop-d0f8c'
ACCOUNT = 'yudith.octo@gmail.com'


def gcloud(*args):
    result = subprocess.run(['gcloud', *args, f'--project={PROJECT}', f'--account={ACCOUNT}', '--quiet'], capture_output=True, text=True)
    if result.returncode:
        raise ValueError('SISKOP configuration operation failed: ' + ' '.join(args[:3]))
    return result.stdout


def main():
    plain_names = {'NODE_ENV', 'PUBLIC_APP_URL', 'CORS_ORIGIN', 'FIREBASE_PROJECT_ID', 'TENANT_BASE_DOMAIN',
                   'FIREBASE_ACCOUNT_PROVISIONING_ENABLED', 'TENANT_DOMAINS_ENABLED', 'TENANT_DOMAIN_RENAME_ENABLED',
                   'TENANT_LOGIN_SELECTION_ENABLED', 'TENANT_SWITCHING_ENABLED'}
    secret_names = {'JWT_SECRET', 'JWT_REFRESH_SECRET', 'XENDIT_SECRET_KEY', 'XENDIT_WEBHOOK_TOKEN',
                    'TENANT_GATEWAY_SECRET', 'SCHEDULER_SECRET', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'}
    service = json.loads(gcloud('run', 'services', 'describe', 'siskop-staging-api', '--region=asia-southeast2', '--format=json'))
    env = {}; pins = {}
    for item in service['spec']['template']['spec']['containers'][0].get('env', []):
        name = item['name']
        if name in plain_names and 'value' in item:
            env[name] = item['value']
        if name in secret_names:
            ref = item.get('valueFrom', {}).get('secretKeyRef', {})
            if ref.get('name') != name or not ref.get('key', '').isdigit():
                raise ValueError('Explicit numeric SISKOP secret version required')
            env[name] = gcloud('secrets', 'versions', 'access', ref['key'], '--secret=' + name).rstrip('\n')
            pins[name] = ref['key']
    if not {'JWT_SECRET', 'JWT_REFRESH_SECRET', 'SCHEDULER_SECRET', 'TENANT_GATEWAY_SECRET', 'XENDIT_SECRET_KEY'}.issubset(env):
        raise ValueError('Required SISKOP source settings are missing')
    if not env['XENDIT_SECRET_KEY'].startswith('xnd_development_'):
        raise ValueError('Staging requires the existing Xendit test credential')
    # This new key signs only central forwarding traffic; tenant keys remain unchanged.
    name = 'SISKOP_CENTRAL_GATEWAY_SECRET'
    exists = subprocess.run(['gcloud', 'secrets', 'describe', name, f'--project={PROJECT}', f'--account={ACCOUNT}', '--format=json'], capture_output=True, text=True)
    if exists.returncode:
        if 'NOT_FOUND' not in exists.stderr:
            raise ValueError('Cannot inspect central gateway secret')
        value = secrets.token_hex(32)
        created = subprocess.run(['gcloud', 'secrets', 'create', name, '--replication-policy=automatic', '--data-file=-', f'--project={PROJECT}', f'--account={ACCOUNT}', '--quiet'],
                                 input=value, capture_output=True, text=True)
        if created.returncode: raise ValueError('Central gateway secret creation failed')
    env['CENTRAL_GATEWAY_SECRET'] = gcloud('secrets', 'versions', 'access', '1', '--secret=' + name).rstrip('\n')
    env.update(XENDIT_MODE='test', SCHEDULER_OIDC_AUDIENCE='https://siskop-api.inovasijayakarsa.id:18443',
               SISKOP_RELEASE_ID='contabo-b237020-046b108c3709')
    image = 'asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:046b108c37093950d1586bd4fe86a46e63f3e0c54725b91476bf677312144f20'
    compose = (Path(__file__).parent / 'compose.yaml').read_text()
    remote = '''import sys,json,re,os
sys.path.insert(0,'/srv/siskop/staging')
from siskopctl import ROOT,validate_root
validate_root()
payload=json.load(sys.stdin)
env=payload['env']
assert all(re.fullmatch('[A-Z][A-Z0-9_]*',k) and isinstance(v,str) and '\\n' not in v and '\\r' not in v for k,v in env.items())
password=(ROOT/'secrets/runtime-password').read_text().strip()
assert re.fullmatch('[A-Za-z0-9_-]{40,80}',password)
env['DATABASE_URL']='postgresql://siskop_runtime:'+password+'@postgres:5432/siskop_staging?connection_limit=3&pool_timeout=30'
path=ROOT/'secrets/api.env'
assert not path.is_symlink()
path.write_text(''.join(k+'='+v+'\\n' for k,v in sorted(env.items())))
path.chmod(0o600)
image=payload['image']
assert re.fullmatch('asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:[a-f0-9]{64}',image)
config=ROOT/'compose.env'
settings=dict(line.split('=',1) for line in config.read_text().splitlines() if line and not line.startswith('#'))
settings['SISKOP_API_IMAGE']=image
config.write_text(''.join(k+'='+v+'\\n' for k,v in sorted(settings.items())))
(ROOT/'compose.yaml').write_text(payload['compose'])
(ROOT/'runtime-secret-pins.json').write_text(json.dumps(payload['pins'],indent=2))
print(json.dumps({'configured':'siskop-api-staging','database':'private SISKOP cluster','traffic_switched':False,'secrets_printed':False}))
'''
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'sentryxmonitor', 'python3 -c ' + shlex.quote(remote)],
                            input=json.dumps({'env': env, 'pins': pins, 'image': image, 'compose': compose}), capture_output=True, text=True)
    if result.returncode:
        raise ValueError('Private SISKOP runtime configuration failed')
    print(result.stdout.strip())


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP runtime configuration stopped: {error}') from None
