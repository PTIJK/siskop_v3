#!/usr/bin/env python3
"""Promote a verified fresh SISKOP database only after documented source fencing."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
import re
from siskopctl import ROOT, validate_root, validate_container, sql, compose
from deploy_host import write_private


def validate_evidence(evidence, candidate):
    if (evidence.get('source_project') != 'lovtfdddtafuyldnkbny' or evidence.get('source_write_fenced') is not True
            or evidence.get('schedulers_paused') is not True or evidence.get('release_trigger_disabled') is not True
            or evidence.get('old_api_invocation_blocked') is not True or evidence.get('offhost_restore_verified') is not True
            or evidence.get('archive_sha256') != candidate.get('archive_sha256') or candidate.get('verified') is not True
            or not re.fullmatch(r'siskop_cutover_[a-f0-9]{12}', candidate.get('database', ''))):
        raise ValueError('Final SISKOP source fence/backup evidence is incomplete')
    frozen = datetime.fromisoformat(evidence['frozen_utc'])
    exported = datetime.fromisoformat(candidate['source_created'])
    now = datetime.now(timezone.utc)
    if not frozen <= exported <= now or (now - exported).total_seconds() > 3600:
        raise ValueError('Final export must follow the write fence and be less than one hour old')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{64}', args.sha256): raise ValueError('Exact backup SHA required')
    validate_root(); validate_container(); os.umask(0o077)
    if (ROOT / 'traffic-switched.json').exists(): raise ValueError('SISKOP is already live; automatic source rollback is forbidden')
    candidate = json.loads((ROOT / ('candidate-' + args.sha256[:12] + '.json')).read_text())
    evidence = json.loads((ROOT / 'source-fence.json').read_text())
    validate_evidence(evidence, candidate)
    if candidate['archive_sha256'] != args.sha256: raise ValueError('Candidate checksum differs')
    old = 'siskop_rehearsal_' + args.sha256[:12]
    database = candidate['database']
    if sql("SELECT count(*) FROM pg_database WHERE datname IN ('siskop_staging','" + database + "');", database='postgres').strip() != '2':
        raise ValueError('Canonical and fresh SISKOP databases must both exist')
    if sql("SELECT count(*) FROM pg_database WHERE datname='" + old + "';", database='postgres').strip() != '0':
        raise ValueError('Preserved rehearsal name already exists')
    write_private(ROOT / 'deployment-hold.json', json.dumps({'reason': 'final-database-promotion'}))
    backups = ROOT / 'backup-state'; backups.mkdir(exist_ok=True)
    with (backups / 'backup.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        compose('--profile', 'application', 'stop', '--timeout', '75', 'api')
        # Both renames commit atomically. No database or row is deleted.
        sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('siskop_staging','" + database + "') AND pid<>pg_backend_pid();", database='postgres')
        sql('BEGIN; ALTER DATABASE siskop_staging RENAME TO ' + old + '; ALTER DATABASE ' + database + ' RENAME TO siskop_staging; '
            'REVOKE ALL ON DATABASE ' + old + ' FROM PUBLIC,siskop_runtime,siskop_migration,siskop_backup; ALTER DATABASE ' + old + ' ALLOW_CONNECTIONS false; COMMIT;', database='postgres')
        compose('--profile', 'application', 'up', '-d', '--no-deps', 'api')
    # Keep the deployment hold until routing, OIDC schedulers and backup checks finish.
    report = {'database': 'siskop_staging', 'preserved_rehearsal': old, 'archive_sha256': args.sha256,
              'promoted_utc': datetime.now(timezone.utc).isoformat(), 'traffic_switched': False}
    write_private(ROOT / 'database-promoted.json', json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        raise SystemExit('SISKOP promotion stopped: ' + str(error)) from None
