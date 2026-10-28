#!/srv/siskop/staging/jobs-venv/bin/python
"""Maintain only the SISKOP proxy; open first traffic after attested release/recovery."""
import argparse
from datetime import datetime, timezone
import json
import os
from google_client import session
from deploy_host import UUID, health, get_json, validate_request, write_private
from siskopctl import ROOT, validate_root, command

HELD = '''map "$request_method:$uri" $siskop_maintenance {
 default 1;
 ~^GET:(/health|/api/health|/api/onboarding/packages|/api/tenant-access/config|/api/workspace|/api/scheduler/status)$ 0;
}
'''
OPEN = 'map $request_method $siskop_maintenance { default 0; }\n'


def set_access(held, reload=True):
    validate_root()
    folder = ROOT / 'proxy-state'
    if folder.is_symlink(): raise ValueError('Unexpected SISKOP proxy state directory')
    folder.mkdir(exist_ok=True); folder.chmod(0o755)
    target = folder / 'access.conf'
    if target.is_symlink(): raise ValueError('Unexpected SISKOP proxy state file')
    prior = target.read_text() if target.exists() else None
    temporary = folder / 'access.pending'; temporary.write_text(HELD if held else OPEN); temporary.chmod(0o644); temporary.replace(target)
    if reload:
        proxy = json.loads(command(['docker', 'inspect', 'siskop-proxy-staging']))[0]
        labels = proxy['Config'].get('Labels', {})
        mounts = {m['Destination']: m['Source'] for m in proxy['Mounts'] if m['Type'] == 'bind'}
        if labels.get('com.siskop.application') != 'siskop' or labels.get('com.docker.compose.project') != 'siskop-staging' or mounts.get('/etc/siskop-state') != str(folder):
            raise ValueError('Refusing non-SISKOP proxy or unexpected state mount')
        try: command(['docker', 'exec', 'siskop-proxy-staging', 'nginx', '-t'])
        except Exception:
            if prior is not None: target.write_text(prior)
            raise
        command(['docker', 'exec', 'siskop-proxy-staging', 'nginx', '-s', 'reload'])
    write_private(ROOT / 'maintenance-state.json', json.dumps({'enabled': held, 'updated_utc': datetime.now(timezone.utc).isoformat()}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['hold', 'open'])
    parser.add_argument('--build-id')
    args = parser.parse_args(); validate_root(); os.umask(0o077)
    if args.action == 'hold':
        set_access(True)
        print(json.dumps({'siskop_maintenance': True, 'sentryx_changed': False})); return
    if not UUID.fullmatch(args.build_id or ''): raise ValueError('Exact successful Cloud Build required')
    authority = json.loads((ROOT / 'database-authoritative.json').read_text())
    promoted = json.loads((ROOT / 'database-promoted.json').read_text())
    if authority.get('archive_sha256') != promoted.get('archive_sha256') or authority.get('source_write_fenced') is not True:
        raise ValueError('Final database authority/fence evidence is incomplete')
    report = json.loads((ROOT / 'release-state/last-deployed.json').read_text())
    if report.get('buildId') != args.build_id or report.get('success') is not True: raise ValueError('Expected SISKOP API was not deployed')
    client = session('deployer')
    build = get_json(client, 'https://cloudbuild.googleapis.com/v1/projects/siskop-d0f8c/locations/asia-southeast2/builds/' + args.build_id)
    validate_request({key: report[key] for key in ['buildId', 'commit', 'image']}, build)
    steps = {step.get('id'): step.get('status') for step in build.get('steps', [])}
    if build.get('status') != 'SUCCESS' or any(steps.get(name) != 'SUCCESS' for name in ['publish-frontend', 'publish-tenant-hosting', 'verify-and-finish-release']):
        raise ValueError('Coordinated frontend/tenant/scheduler release must succeed before opening traffic')
    backup = json.loads((ROOT / 'backup-state/last-success.json').read_text())
    proof = json.loads((ROOT / 'authoritative-restore-verification.json').read_text())
    now = datetime.now(timezone.utc)
    if (backup.get('authoritative') is not True or (now - datetime.fromisoformat(backup['completed_utc'])).total_seconds() > 5400
            or proof.get('verified') is not True or proof.get('authoritative') is not True
            or datetime.fromisoformat(proof['backup_completed_utc']) < datetime.fromisoformat(promoted['promoted_utc'])):
        raise ValueError('A fresh authoritative off-host backup and successful restore are required')
    health(args.build_id)
    set_access(False)
    write_private(ROOT / 'traffic-switched.json', json.dumps({'buildId': args.build_id, 'commit': report['commit'],
        'completed_utc': now.isoformat(), 'source_write_fenced': True, 'database': 'siskop_staging'}, indent=2))
    print(json.dumps({'siskop_maintenance': False, 'database': 'contabo', 'buildId': args.build_id, 'sentryx_changed': False}))


if __name__ == '__main__':
    try: main()
    except Exception as error: raise SystemExit('SISKOP maintenance change stopped: ' + str(error)) from None
