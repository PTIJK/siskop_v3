#!/srv/siskop/staging/jobs-venv/bin/python
"""Publish only SISKOP health and backup-age metrics; no business rows or logs."""
from datetime import datetime, timezone
import argparse
import json
import os
from google_client import session
from siskopctl import ROOT, validate_root, validate_container, command
from deploy_host import health


def backup_age(report, now):
    if report.get('authoritative') is not True: return 86400
    completed = datetime.fromisoformat(report['completed_utc'])
    return max(0, int((now - completed).total_seconds()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearsal', action='store_true')
    args = parser.parse_args()
    validate_root()
    if not args.rehearsal and not (ROOT / 'traffic-switched.json').is_file():
        print('SISKOP health metrics held until live cutover'); return
    now = datetime.now(timezone.utc); healthy = True
    try:
        validate_container()
        health()
        command(['openssl', 'x509', '-in', str(ROOT / 'letsencrypt/live/siskop-api.inovasijayakarsa.id/fullchain.pem'), '-checkend', '604800', '-noout'])
        disk = os.statvfs(ROOT)
        if disk.f_bavail * disk.f_frsize < 5 * 1024 ** 3: healthy = False
    except Exception: healthy = False
    try: age = backup_age(json.loads((ROOT / 'backup-state/last-success.json').read_text()), now)
    except Exception: age = 86400
    points = []
    for name, value in [('backup_age_seconds', age), ('health_ok', int(healthy))]:
        points.append({'metric': {'type': 'custom.googleapis.com/siskop/' + name},
            'resource': {'type': 'global', 'labels': {'project_id': 'siskop-d0f8c'}},
            'points': [{'interval': {'endTime': now.isoformat()}, 'value': {'int64Value': str(value)}}]})
    response = session('backup').post('https://monitoring.googleapis.com/v3/projects/siskop-d0f8c/timeSeries', json={'timeSeries': points}, timeout=30)
    if response.status_code != 200: raise ValueError('SISKOP metric upload failed')
    print(json.dumps({'siskop_health_ok': healthy, 'backup_age_seconds': age, 'metrics_uploaded': True}))


if __name__ == '__main__':
    try: main()
    except Exception as error: raise SystemExit('SISKOP health check failed: ' + type(error).__name__) from None
