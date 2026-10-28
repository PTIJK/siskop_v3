#!/usr/bin/env python3
"""Install SISKOP files only into a NEW /srv/siskop/staging deployment."""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path('/srv/siskop/staging')


def main():
    if os.geteuid() != 0 or socket.gethostname() != 'vmi3303548' or ROOT.exists():
        raise SystemExit('Refusing existing deployment or unexpected host/user')
    payload = json.load(sys.stdin)
    if set(payload) != {'compose.yaml', 'siskopctl.py', 'postgres_image'}:
        raise SystemExit('Unexpected installation payload')
    import re
    if not re.fullmatch(r'postgres@sha256:[a-f0-9]{64}', payload['postgres_image']):
        raise SystemExit('Immutable PostgreSQL image required')
    # Capture only identity/state fields, never container environment secrets.
    ids = subprocess.check_output(['docker', 'ps', '-aq'], text=True).split()
    before = {}
    for cid in ids:
        data = json.loads(subprocess.check_output(['docker', 'inspect', cid]))[0]
        before[data['Name']] = {'id': data['Id'], 'started': data['State']['StartedAt'], 'restarts': data['RestartCount']}
    os.umask(0o077)
    ROOT.mkdir(parents=True, mode=0o700)
    (ROOT / 'secrets').mkdir(mode=0o700)
    (ROOT / 'postgres').mkdir(mode=0o700)
    os.chown(ROOT / 'postgres', 999, 999)
    for name in ['compose.yaml', 'siskopctl.py']:
        (ROOT / name).write_text(payload[name])
    marker = {'application': 'siskop', 'environment': 'staging', 'host': 'vmi3303548', 'database': 'siskop_staging'}
    (ROOT / 'deployment.json').write_text(json.dumps(marker))
    (ROOT / 'preexisting-container-state.json').write_text(json.dumps(before, indent=2))
    (ROOT / 'compose.env').write_text(f"SISKOP_POSTGRES_IMAGE={payload['postgres_image']}\n")
    for role in ['bootstrap', 'runtime', 'migration', 'backup']:
        path = ROOT / f'secrets/{role}-password'
        path.write_text(secrets.token_urlsafe(36))
        if role == 'bootstrap':
            os.chown(path, 999, 999)
            path.chmod(0o400)
    (ROOT / 'secrets/api.env').write_text('# API not deployed until rehearsal gates pass\n')
    print(json.dumps({'installed': 'siskop', 'root': str(ROOT), 'existing_containers_recorded': len(before), 'services_started': False}))


if __name__ == '__main__':
    main()
