#!/usr/bin/env python3
"""Atomically publish the SISKOP TLS bundle; reload only its own proxy."""
import argparse
import json
import os
import subprocess
import tempfile
from siskopctl import ROOT, validate_root, command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reload', action='store_true')
    args = parser.parse_args()
    validate_root()
    cert = ROOT / 'letsencrypt/live/siskop-api.inovasijayakarsa.id/fullchain.pem'
    key = cert.with_name('privkey.pem')
    command(['openssl', 'x509', '-in', str(cert), '-checkhost', 'siskop-api.inovasijayakarsa.id', '-checkend', '604800', '-noout'])
    cert_public = command(['openssl', 'x509', '-in', str(cert), '-pubkey', '-noout'])
    key_public = command(['openssl', 'pkey', '-in', str(key), '-pubout'])
    if cert_public != key_public:
        raise ValueError('SISKOP certificate/key mismatch')
    destination = ROOT / 'tls'
    destination.mkdir(exist_ok=True)
    if destination.is_symlink():
        raise ValueError('Unexpected TLS directory symlink')
    os.chown(destination, 0, 101); destination.chmod(0o750)
    target = destination / 'bundle.pem'
    previous = target.read_bytes() if target.exists() else None
    with tempfile.NamedTemporaryFile(dir=destination, delete=False) as output:
        output.write(cert.read_bytes() + b'\n' + key.read_bytes())
        temporary = output.name
    os.chown(temporary, 0, 101); os.chmod(temporary, 0o440)
    os.replace(temporary, target)
    if args.reload:
        data = json.loads(command(['docker', 'inspect', 'siskop-proxy-staging']))[0]
        labels = data['Config'].get('Labels', {})
        if labels.get('com.docker.compose.project') != 'siskop-staging' or labels.get('com.siskop.application') != 'siskop':
            raise ValueError('Refusing a non-SISKOP proxy')
        check = subprocess.run(['docker', 'exec', 'siskop-proxy-staging', 'nginx', '-t'], capture_output=True)
        if check.returncode:
            if previous is not None: target.write_bytes(previous)
            raise ValueError('SISKOP proxy certificate validation failed; previous bundle retained')
        command(['docker', 'exec', 'siskop-proxy-staging', 'nginx', '-s', 'reload'])
    print(json.dumps({'siskop_tls_published': True, 'siskop_proxy_reloaded': args.reload, 'shared_host_proxy_reloaded': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP TLS deployment stopped: {type(error).__name__}') from None
