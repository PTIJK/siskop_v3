#!/srv/siskop/staging/jobs-venv/bin/python
"""Snapshot-consistent encrypted SISKOP-only backups, uploaded off the VPS."""
import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from google_client import session
from siskopctl import ROOT, CONTAINER, validate_root, validate_container, command

BUCKET = 'siskop-d0f8c-db-backups'


def upload(client, file, name):
    import google_crc32c
    payload = file.read_bytes()
    if len(payload) > 128 * 1024 * 1024:
        raise ValueError('Backup exceeds reviewed upload memory budget; use resumable upload before growth')
    checksum = base64.b64encode(google_crc32c.Checksum(payload).digest()).decode()
    metadata = json.dumps({'name': name, 'crc32c': checksum, 'metadata': {'sha256': hashlib.sha256(payload).hexdigest()}}).encode()
    boundary = 'siskop-' + secrets.token_hex(16)
    body = (f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'.encode() + metadata +
            f'\r\n--{boundary}\r\nContent-Type: application/pkcs7-mime\r\n\r\n'.encode() + payload + f'\r\n--{boundary}--\r\n'.encode())
    response = client.post(f'https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o',
                           params={'uploadType': 'multipart', 'ifGenerationMatch': '0'}, data=body,
                           headers={'Content-Type': f'multipart/related; boundary={boundary}'}, timeout=120)
    if response.status_code not in {200, 201}:
        raise ValueError('Encrypted SISKOP off-host upload failed')
    info = response.json()
    if info.get('crc32c') != checksum or int(info['size']) != len(payload):
        raise ValueError('Off-host backup checksum or size mismatch')
    return {'name': name, 'generation': info['generation'], 'bytes': len(payload), 'crc32c': checksum}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearsal', action='store_true')
    args = parser.parse_args()
    validate_root(); validate_container()
    if not args.rehearsal and not (ROOT / 'database-authoritative.json').is_file():
        print('SISKOP live cutover not marked; destination backup timer is inactive')
        return
    os.umask(0o077)
    backups = ROOT / 'backup-state'
    backups.mkdir(exist_ok=True)
    with (backups / 'backup.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        env['PGPASSWORD'] = (ROOT / 'secrets/backup-password').read_text().strip()
        env['PGOPTIONS'] = '-c timezone=UTC -c datestyle=ISO,YMD'
        prefix = ['docker', 'exec', '-i', '-e', 'PGPASSWORD', '-e', 'PGOPTIONS', CONTAINER]
        psql = subprocess.Popen(prefix + ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'siskop_backup', '-d', 'siskop_staging'],
                                env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)

        def query(sql):
            psql.stdin.write(sql + '\n'); psql.stdin.flush()
            answer = psql.stdout.readline()
            if not answer:
                raise ValueError('SISKOP backup snapshot connection failed')
            return answer.strip()

        try:
            snapshot = query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();')
            if query('SELECT current_database();') != 'siskop_staging':
                raise ValueError('Unexpected backup database')
            # Do not silently export an empty subset if a future migration
            # enables RLS without the dedicated complete-backup read policy.
            unsafe = query("""SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.oid=format('%I.%I',t.schemaname,t.tablename)::regclass
WHERE t.schemaname='public' AND c.relrowsecurity AND (
 NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename AND p.policyname='siskop_backup_read' AND p.cmd='SELECT' AND p.qual='true' AND p.roles=ARRAY['siskop_backup']::name[])
 OR EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename AND p.permissive='RESTRICTIVE' AND p.cmd IN ('SELECT','ALL') AND (p.roles @> ARRAY['siskop_backup']::name[] OR p.roles @> ARRAY['public']::name[]))
);""")
            if unsafe != '0':
                raise ValueError('Backup RLS coverage changed; refusing an incomplete export')
            tables = json.loads(query("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';"))
            if not {'Tenant', 'User', '_prisma_migrations'}.issubset(tables):
                raise ValueError('Unexpected backup schema')
            now = datetime.now(timezone.utc)
            manifest = {'application': 'siskop', 'database': 'siskop_staging', 'created_utc': now.isoformat(), 'tables': {}}
            for table in tables:
                ident = '"' + table.replace('"', '""') + '"'
                manifest['tables'][table] = json.loads(query("SELECT json_build_object('rows',count(*),'content_md5',md5(coalesce(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public." + ident + ' t) hashes;'))
            with tempfile.TemporaryDirectory(prefix='backup-', dir=ROOT) as temp:
                folder = Path(temp); dump = folder / 'siskop.dump'
                with dump.open('wb') as output:
                    result = subprocess.run(prefix + ['pg_dump', '-U', 'siskop_backup', '-d', 'siskop_staging', '--no-password',
                        '--schema=public', '--enable-row-security', '--no-acl', '--format=custom', '--lock-wait-timeout=10s', '--snapshot=' + snapshot],
                        env=env, stdout=output, stderr=subprocess.PIPE)
                if result.returncode:
                    raise ValueError('SISKOP backup export failed')
                psql.stdin.write('COMMIT;\n\\q\n'); psql.stdin.flush(); psql.wait(timeout=15)
                if psql.returncode:
                    raise ValueError('SISKOP backup snapshot did not finish')
                manifest['dump_sha256'] = hashlib.sha256(dump.read_bytes()).hexdigest()
                source_manifest = folder / 'manifest.json'
                source_manifest.write_text(json.dumps(manifest, indent=2))
                for file in [dump, source_manifest]:
                    command(['openssl', 'cms', '-encrypt', '-aes-256-gcm', '-binary', '-outform', 'DER',
                             '-in', str(file), '-out', str(file) + '.cms', str(ROOT / 'backup-recipient.pem')])
                stamp = now.strftime('%Y/%m/%d/%H%M%S') + '-' + secrets.token_hex(6)
                prefixes = ['rehearsal/' + stamp] if args.rehearsal else ['contabo/hourly/' + stamp]
                if not args.rehearsal and now.hour == 0:
                    prefixes.append('contabo/daily/' + stamp)
                    if now.weekday() == 0: prefixes.append('contabo/weekly/' + stamp)
                client = session('backup')
                objects = [upload(client, folder / name, prefix_name + '/' + name)
                           for prefix_name in prefixes for name in ['siskop.dump.cms', 'manifest.json.cms']]
                report = {'completed_utc': datetime.now(timezone.utc).isoformat(), 'authoritative': not args.rehearsal,
                          'tables': len(tables), 'rows': sum(x['rows'] for x in manifest['tables'].values()), 'objects': objects}
                target = backups / ('rehearsal-success.json' if args.rehearsal else 'last-success.json')
                temporary = target.with_suffix('.pending'); temporary.write_text(json.dumps(report, indent=2)); temporary.replace(target)
                print(json.dumps({'backup_uploaded': True, 'authoritative': report['authoritative'], 'tables': len(tables), 'objects': len(objects)}))
        finally:
            if psql.poll() is None: psql.kill(); psql.wait()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP backup failed: {type(error).__name__}') from None
