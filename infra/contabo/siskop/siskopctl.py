#!/usr/bin/env python3
"""Narrow SISKOP host operations. No arbitrary Compose or Docker arguments."""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess

ROOT = Path('/srv/siskop/staging')
HOST = 'vmi3303548'
PROJECT = 'siskop-staging'
CONTAINER = 'siskop-postgres-staging'


def validate_root(root=ROOT, hostname=None):
    if Path(root) != ROOT or root.resolve() != ROOT or (hostname or socket.gethostname()) != HOST:
        raise ValueError('Refusing unexpected SISKOP directory or host')
    for path in [ROOT, ROOT / 'deployment.json', ROOT / 'compose.yaml', ROOT / 'compose.env']:
        if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
            raise ValueError('SISKOP control files must be root-owned and not group/world writable')
    for path in [ROOT / 'postgres', ROOT / 'secrets']:
        if path.is_symlink() or path.resolve() != path:
            raise ValueError('SISKOP data and secret directories cannot redirect to another application')
    marker = json.loads((ROOT / 'deployment.json').read_text())
    if marker != {'application': 'siskop', 'environment': 'staging', 'host': HOST, 'database': 'siskop_staging'}:
        raise ValueError('SISKOP deployment marker mismatch')
    settings = dict(line.split('=', 1) for line in (ROOT / 'compose.env').read_text().splitlines() if line and not line.startswith('#'))
    if not re.fullmatch(r'postgres@sha256:[a-f0-9]{64}', settings.get('SISKOP_POSTGRES_IMAGE', '')):
        raise ValueError('Pinned PostgreSQL digest required')


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} operation failed ({result.returncode}); private diagnostics required')
    return result.stdout


def compose(*args):
    return command(['docker', 'compose', '--project-name', PROJECT, '--env-file', str(ROOT / 'compose.env'),
                    '--file', str(ROOT / 'compose.yaml'), *args], cwd=ROOT)


def validate_container():
    data = json.loads(command(['docker', 'inspect', CONTAINER]))[0]
    labels = data['Config'].get('Labels', {})
    if labels.get('com.docker.compose.project') != PROJECT or labels.get('com.siskop.application') != 'siskop':
        raise ValueError('Refusing non-SISKOP container')
    mounts = {m['Destination']: m['Source'] for m in data['Mounts'] if m['Type'] == 'bind'}
    if mounts != {'/var/lib/postgresql/data': str(ROOT / 'postgres'), '/run/secrets/bootstrap-password': str(ROOT / 'secrets/bootstrap-password')}:
        raise ValueError('Unexpected SISKOP database mounts')
    if data['HostConfig'].get('PortBindings') or set(data['NetworkSettings']['Networks']) != {'siskop-staging-database'}:
        raise ValueError('Database must be private to the SISKOP network')
    return data


def sql(query):
    validate_container()
    # The bootstrap password is resolved only inside this one SISKOP container.
    return command(['docker', 'exec', '-i', CONTAINER, 'sh', '-c',
                    'PGPASSWORD="$(cat /run/secrets/bootstrap-password)" exec psql -X -qAt -v ON_ERROR_STOP=1 -U siskop_bootstrap -d siskop_staging'],
                   input=query.encode()).decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['db-up', 'status'])
    args = parser.parse_args()
    validate_root()
    if args.operation == 'db-up':
        # Never --remove-orphans, down, prune, or restart another project.
        compose('up', '-d', '--no-deps', 'postgres')
    container = validate_container()
    print(json.dumps({'application': 'siskop', 'container': CONTAINER,
                      'state': container['State']['Status'],
                      'health': container['State'].get('Health', {}).get('Status'),
                      'published_ports': False, 'network': 'siskop-staging-database'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP operation stopped: {error}') from None
