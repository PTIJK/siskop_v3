#!/usr/bin/env python3
"""Install one SISKOP virtual host, preserving all preexisting site files."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from siskopctl import ROOT, validate_root, command

SITE = 'siskop-api.inovasijayakarsa.id'
AVAILABLE = Path('/etc/nginx/sites-available') / SITE
ENABLED = Path('/etc/nginx/sites-enabled') / SITE


def site_hashes():
    result = {}
    for directory in ['/etc/nginx/sites-available', '/etc/nginx/sites-enabled', '/etc/nginx/conf.d']:
        for p in Path(directory).iterdir():
            if p.name == SITE or not p.is_file():
                continue
            result[str(p)] = hashlib.sha256(p.read_bytes()).hexdigest()
    return result


def main():
    validate_root()
    payload = json.load(sys.stdin)
    if set(payload) != {'phase', 'content'} or payload['phase'] not in {'http', 'https'}:
        raise ValueError('Unexpected SISKOP ingress request')
    content = payload['content']
    if 'server_name siskop-api.inovasijayakarsa.id;' not in content or 'sentryx' in content.lower():
        raise ValueError('Unexpected ingress configuration')
    baseline_file = ROOT / 'nginx-baseline.json'
    current = site_hashes()
    if baseline_file.exists():
        if json.loads(baseline_file.read_text()) != current:
            raise ValueError('Preexisting site configuration changed; review before proceeding')
    else:
        if AVAILABLE.exists() or ENABLED.exists():
            raise ValueError('Unmanaged SISKOP site already exists')
        baseline_file.write_text(json.dumps(current, indent=2))
    if payload['phase'] == 'https' and not (ROOT / f'letsencrypt/live/{SITE}/fullchain.pem').is_file():
        raise ValueError('SISKOP certificate must exist before enabling HTTPS')
    previous = AVAILABLE.read_text() if AVAILABLE.exists() else None
    AVAILABLE.write_text(content)
    AVAILABLE.chmod(0o644)
    if not ENABLED.exists():
        ENABLED.symlink_to(AVAILABLE)
    if not ENABLED.is_symlink() or ENABLED.resolve() != AVAILABLE:
        raise ValueError('SISKOP site symlink mismatch')
    Path('/var/www/siskop-acme/.well-known/acme-challenge').mkdir(parents=True, exist_ok=True)
    test = subprocess.run(['nginx', '-t'], capture_output=True)
    if test.returncode:
        if previous is None:
            ENABLED.unlink(); AVAILABLE.unlink()
        else:
            AVAILABLE.write_text(previous)
        raise ValueError('Proxy validation failed; SISKOP configuration rolled back without reload')
    if site_hashes() != current:
        raise ValueError('Non-SISKOP site file changed; refusing reload')
    master_before = command(['systemctl', 'show', 'nginx', '--property=MainPID', '--value']).strip()
    command(['systemctl', 'reload', 'nginx'])
    master_after = command(['systemctl', 'show', 'nginx', '--property=MainPID', '--value']).strip()
    if master_before != master_after:
        raise ValueError('Proxy master PID changed unexpectedly')
    print(json.dumps({'siskop_ingress': payload['phase'], 'preexisting_site_files_unchanged': len(current), 'proxy_master_pid_unchanged': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP ingress stopped: {error}') from None
