#!/srv/siskop/staging/jobs-venv/bin/python
"""Pull attested SISKOP releases. No inbound shell, generic RPC or Docker socket."""
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.parse import quote
from urllib.request import Request, urlopen
from google_client import session
from siskopctl import ROOT, PROJECT, validate_root, validate_container, command, compose
from restore_initial import runtime_grants

BUCKET = 'siskop-d0f8c-contabo-releases'
IMAGE = 'asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api'
BUILDER = 'projects/siskop-d0f8c/serviceAccounts/siskop-cloud-build@siskop-d0f8c.iam.gserviceaccount.com'
TRIGGER = '8346644b-e829-4692-8226-fad4c3c5ce28'
UUID = re.compile(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\Z')


def validate_request(data, build):
    if set(data) != {'buildId', 'commit', 'image'} or not UUID.fullmatch(data.get('buildId', '')):
        raise ValueError('Unexpected release metadata')
    if not re.fullmatch(r'[a-f0-9]{40}', data.get('commit', '')) or not re.fullmatch(re.escape(IMAGE) + r'@sha256:[a-f0-9]{64}', data.get('image', '')):
        raise ValueError('Only immutable SISKOP release images are accepted')
    substitutions = build.get('substitutions', {})
    steps = {step.get('id'): step.get('status') for step in build.get('steps', [])}
    resolved = build.get('sourceProvenance', {}).get('resolvedRepoSource', {}).get('commitSha')
    if (build.get('id') != data['buildId'] or build.get('buildTriggerId') != TRIGGER
            or build.get('serviceAccount') != BUILDER or build.get('status') not in {'WORKING', 'SUCCESS'}
            or substitutions.get('BRANCH_NAME') != 'main' or substitutions.get('COMMIT_SHA') != data['commit']
            or substitutions.get('_DEPLOY', 'true') != 'true' or substitutions.get('_BACKEND') != 'contabo'
            or (resolved is not None and resolved != data['commit'])
            or any(steps.get(step) != 'SUCCESS' for step in ['verify-and-build-frontend', 'push-backend'])):
        raise ValueError('Release is not an attested, tested SISKOP main build')
    # Reject ancient/replayed builds and provider timestamps that cannot order releases.
    created = datetime.fromisoformat(build['createTime'].replace('Z', '+00:00'))
    if not 0 <= (datetime.now(timezone.utc) - created).total_seconds() <= 7200:
        raise ValueError('Release request is stale')
    return created


def get_json(client, url, **kwargs):
    response = client.get(url, timeout=30, **kwargs)
    if response.status_code != 200 or len(response.content) > 2 * 1024 * 1024:
        raise ValueError('SISKOP release metadata lookup failed')
    return response.json()


def artifact_digest(client, build_id):
    url = 'https://artifactregistry.googleapis.com/v1/projects/siskop-d0f8c/locations/asia-southeast2/repositories/siskop-staging/packages/api/tags/' + quote(build_id, safe='')
    data = get_json(client, url)
    digest = data.get('version', '').rsplit('/versions/', 1)[-1]
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('Unexpected registry version')
    return IMAGE + '@' + digest


def write_private(path, value):
    pending = path.with_suffix(path.suffix + '.pending')
    pending.write_text(value)
    pending.chmod(0o600)
    pending.replace(path)


def health(revision):
    values = dict(line.split('=', 1) for line in (ROOT / 'secrets/api.env').read_text().splitlines() if line and not line.startswith('#'))
    path = '/api/public/pricing'
    stamp = str(int(time.time() * 1000))
    signature = base64.urlsafe_b64encode(hmac.new(values['CENTRAL_GATEWAY_SECRET'].encode(), f'central\n{stamp}\nGET\n{path}'.encode(), hashlib.sha256).digest()).decode().rstrip('=')
    request = Request('http://127.0.0.1:18081' + path, headers={'x-siskop-central-time': stamp, 'x-siskop-central-signature': signature})
    with urlopen(request, timeout=10) as response:
        data = json.load(response)
    if data.get('success') is not True or not data.get('data', {}).get('version') or not data['data'].get('packages'):
        raise ValueError('New SISKOP API failed database readiness')
    # Check the actual process environment, never the desired env file alone.
    observed = command(['docker', 'exec', 'siskop-api-staging', 'node', '-e', 'process.stdout.write(process.env.SISKOP_RELEASE_ID || "")']).decode()
    if observed != revision:
        raise ValueError('New SISKOP API release identity mismatch')


def deploy(client, data):
    validate_root(); validate_container()
    api = json.loads(command(['docker', 'inspect', 'siskop-api-staging']))[0]
    if api['Config'].get('Labels', {}).get('com.docker.compose.project') != PROJECT or api['Config']['Labels'].get('com.siskop.application') != 'siskop':
        raise ValueError('Unexpected API container')
    old_compose = (ROOT / 'compose.env').read_text()
    old_runtime = (ROOT / 'secrets/api.env').read_text()
    with tempfile.TemporaryDirectory(prefix='release-', dir=ROOT) as temporary:
        folder = Path(temporary)
        # AuthorizedSession refreshes only this dedicated registry-reader credential.
        from google.auth.transport.requests import Request as AuthRequest
        client.credentials.refresh(AuthRequest())
        docker_config = folder / 'docker'; docker_config.mkdir()
        auth = base64.b64encode(('oauth2accesstoken:' + client.credentials.token).encode()).decode()
        (docker_config / 'config.json').write_text(json.dumps({'auths': {'asia-southeast2-docker.pkg.dev': {'auth': auth}}}))
        command(['docker', '--config', str(docker_config), 'pull', data['image']], timeout=300)
        password = (ROOT / 'secrets/migration-password').read_text().strip()
        migration_env = folder / 'migration.env'
        migration_env.write_text('DATABASE_URL=postgresql://siskop_migration:' + password + '@postgres:5432/siskop_staging?connection_limit=1\nNODE_ENV=production\n')
        command(['docker', 'run', '--rm', '--name', 'siskop-migrate-staging', '--network', 'siskop-staging-database',
                 '--label', 'com.siskop.application=siskop', '--label', 'com.docker.compose.project=' + PROJECT,
                 '--user', '1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
                 '--cpus=1', '--memory=512m', '--memory-swap=512m', '--pids-limit=128', '--tmpfs', '/tmp:size=64m,uid=1000,gid=1000,mode=1777',
                 '--env-file', str(migration_env), data['image'], 'node', '/app/apps/backend/node_modules/prisma/build/index.js',
                 'migrate', 'deploy', '--schema=/app/apps/backend/prisma/schema.prisma'], timeout=620)
        runtime_grants()
        build = get_json(client, 'https://cloudbuild.googleapis.com/v1/projects/siskop-d0f8c/locations/asia-southeast2/builds/' + data['buildId'])
        validate_request(data, build)
    # Credentials never change during a release. Only image and release metadata move.
    settings = dict(line.split('=', 1) for line in old_compose.splitlines() if line and not line.startswith('#'))
    settings['SISKOP_API_IMAGE'] = data['image']
    runtime = dict(line.split('=', 1) for line in old_runtime.splitlines() if line and not line.startswith('#'))
    runtime['SISKOP_RELEASE_ID'] = data['buildId']
    write_private(ROOT / 'compose.env', ''.join(k + '=' + v + '\n' for k, v in settings.items()))
    write_private(ROOT / 'secrets/api.env', ''.join(k + '=' + v + '\n' for k, v in runtime.items()))
    try:
        compose('--profile', 'application', 'up', '-d', '--no-deps', 'api')
        for _ in range(30):
            try:
                health(data['buildId']); break
            except Exception:
                time.sleep(2)
        else:
            raise ValueError('Candidate API did not become ready')
    except Exception:
        write_private(ROOT / 'compose.env', old_compose)
        write_private(ROOT / 'secrets/api.env', old_runtime)
        compose('--profile', 'application', 'up', '-d', '--no-deps', 'api')
        raise


def receipt(client, data, result):
    name = 'contabo-receipts/' + data['buildId'] + '.json'
    response = client.post(f'https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o',
        params={'uploadType': 'media', 'name': name, 'ifGenerationMatch': '0'},
        data=json.dumps({**data, **result}).encode(), headers={'Content-Type': 'application/json'}, timeout=30)
    if response.status_code not in {200, 201, 412}:
        raise ValueError('Release receipt upload failed')


def main():
    os.umask(0o077); validate_root(); validate_container()
    if not (ROOT / 'database-authoritative.json').is_file() or (ROOT / 'deployment-hold.json').exists():
        print('SISKOP release mailbox held until live cutover is ready'); return
    state = ROOT / 'release-state'; state.mkdir(exist_ok=True)
    with (state / 'release.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        client = session('deployer')
        page = None; objects = []
        for _ in range(10):
            result = get_json(client, f'https://storage.googleapis.com/storage/v1/b/{BUCKET}/o', params={
                'prefix': 'contabo-requests/', 'maxResults': 1000, **({'pageToken': page} if page else {})})
            objects.extend(result.get('items', [])); page = result.get('nextPageToken')
            if not page: break
        else: raise ValueError('Mailbox requires reviewed archival')
        for item in sorted(objects, key=lambda obj: obj['timeCreated']):
            build_id = item['name'].removeprefix('contabo-requests/').removesuffix('.json')
            if not UUID.fullmatch(build_id) or (state / (build_id + '.json')).exists(): continue
            data = {'buildId': build_id}
            try:
                if int(item['size']) > 4096: raise ValueError('Release request is too large')
                data = get_json(client, f'https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/' + quote(item['name'], safe=''),
                                params={'alt': 'media', 'generation': item['generation']})
                if data.get('buildId') != build_id: raise ValueError('Mailbox identity mismatch')
                build = get_json(client, 'https://cloudbuild.googleapis.com/v1/projects/siskop-d0f8c/locations/asia-southeast2/builds/' + build_id)
                created = validate_request(data, build)
                previous = state / 'last-deployed.json'
                prior = json.loads(previous.read_text()) if previous.exists() else None
                if prior and prior.get('buildId') == build_id and all(prior.get(key) == value for key, value in data.items()):
                    health(build_id)
                    receipt(client, data, {key: prior[key] for key in ['success', 'revision', 'buildCreated', 'completed']})
                    write_private(state / (build_id + '.json'), json.dumps({'success': True}))
                    continue
                if prior and created <= datetime.fromisoformat(prior['buildCreated']):
                    raise ValueError('A newer release has already deployed')
                if artifact_digest(client, build_id) != data['image']: raise ValueError('Build tag digest mismatch')
                deploy(client, data)
                report = {'success': True, 'revision': build_id, 'buildCreated': created.isoformat(), 'completed': datetime.now(timezone.utc).isoformat()}
                write_private(previous, json.dumps({**data, **report}))
            except Exception as error:
                report = {'success': False, 'error': type(error).__name__}
            receipt(client, {'buildId': build_id, **{k: data[k] for k in ['commit', 'image'] if k in data}}, report)
            write_private(state / (build_id + '.json'), json.dumps(report))
            print(json.dumps({'buildId': build_id, **report}), flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        raise SystemExit('SISKOP release stopped: ' + type(error).__name__) from None
