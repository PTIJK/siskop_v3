#!/srv/siskop/staging/jobs-venv/bin/python
"""Certbot hook for one delegated SISKOP validation label; no zone discovery."""
import argparse
import os
import re
import subprocess
import time
from google_client import session

DOMAIN = 'siskop-api.inovasijayakarsa.id'
RECORD = '_acme-challenge.' + DOMAIN + '.'
BASE = 'https://dns.googleapis.com/dns/v1/projects/siskop-d0f8c/managedZones/siskop-api-acme'


def change_body(existing, validation, cleanup=False):
    value = '"' + validation + '"'
    values = list(existing['rrdatas']) if existing else []
    if cleanup:
        if value not in values:
            return None
        values.remove(value)
    elif value not in values:
        values.append(value)
    else:
        return None
    body = {}
    if existing:
        body['deletions'] = [existing]
    if values:
        body['additions'] = [{'name': RECORD, 'type': 'TXT', 'ttl': existing['ttl'] if existing else 60, 'rrdatas': values}]
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['auth', 'cleanup'])
    args = parser.parse_args()
    if os.environ.get('CERTBOT_DOMAIN') != DOMAIN:
        raise ValueError('Refusing certificate request for a different domain')
    validation = os.environ.get('CERTBOT_VALIDATION', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', validation):
        raise ValueError('Unexpected ACME validation value')
    client = session('acme')
    response = client.get(BASE + '/rrsets', params={'name': RECORD, 'type': 'TXT'}, timeout=20)
    if response.status_code != 200:
        raise ValueError('Unable to read SISKOP validation record')
    records = response.json().get('rrsets', [])
    if len(records) > 1 or any(r['name'] != RECORD or r['type'] != 'TXT' for r in records):
        raise ValueError('Unexpected DNS response')
    existing = {k: records[0][k] for k in ['name', 'type', 'ttl', 'rrdatas']} if records else None
    body = change_body(existing, validation, args.phase == 'cleanup')
    if body:
        response = client.post(BASE + '/changes', json=body, timeout=20)
        if response.status_code != 200:
            raise ValueError('SISKOP validation update failed')
    if args.phase == 'auth':
        # The host recursor can retain a negative answer after a new delegation.
        # Check this zone's authoritative server, then allow the TXT TTL to pass.
        for _ in range(20):
            result = subprocess.run(['dig', '@ns-cloud-c1.googledomains.com', '+short', '+time=3', '+tries=1', 'TXT', RECORD], capture_output=True, text=True, timeout=6)
            if '"' + validation + '"' in result.stdout.splitlines():
                time.sleep(60)
                return
            time.sleep(3)
        raise ValueError('SISKOP DNS validation has not propagated')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP certificate hook stopped: {type(error).__name__}') from None
