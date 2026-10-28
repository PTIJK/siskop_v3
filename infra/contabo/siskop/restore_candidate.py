#!/usr/bin/env python3
"""Restore a fresh source archive into a NEW SISKOP database; never replace data."""
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from siskopctl import ROOT, CONTAINER, validate_root, sql, command
from restore_initial import runtime_grants


def validate_manifest(manifest, sha):
    if (not re.fullmatch(r'[a-f0-9]{64}', sha) or manifest.get('source_project') != 'lovtfdddtafuyldnkbny'
            or manifest.get('dump_sha256') != sha or not {'Tenant', 'User', '_prisma_migrations'}.issubset(manifest.get('tables', {}))):
        raise ValueError('Source manifest is not a verified SISKOP archive')
    return 'siskop_cutover_' + sha[:12]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    os.umask(0o077); validate_root()
    path = ROOT / args.manifest
    if path.parent != ROOT or path.is_symlink() or not re.fullmatch(r'source-manifest-[a-f0-9]{12}\.json', path.name):
        raise ValueError('Unexpected private source manifest path')
    manifest = json.loads(path.read_text()); sha = manifest['dump_sha256']
    database = validate_manifest(manifest, sha)
    if sql("SELECT count(*) FROM pg_database WHERE datname='" + database + "';", database='postgres').strip() != '0':
        raise ValueError('Fresh destination already exists; it will never be overwritten')
    with tempfile.TemporaryFile(dir=ROOT) as archive:
        digest = hashlib.sha256(); total = 0
        while chunk := sys.stdin.buffer.read(1024 * 1024):
            total += len(chunk)
            if total > 1024 * 1024 * 1024: raise ValueError('Archive exceeds reviewed size limit')
            digest.update(chunk); archive.write(chunk)
        if digest.hexdigest() != sha: raise ValueError('Incoming archive checksum mismatch')
        sql('CREATE DATABASE ' + database + ' OWNER siskop_owner;', database='postgres')
        sql('REVOKE ALL ON DATABASE ' + database + ' FROM PUBLIC; GRANT CONNECT ON DATABASE ' + database + ' TO siskop_runtime,siskop_migration,siskop_backup; '
            'ALTER ROLE siskop_migration IN DATABASE ' + database + ' SET role=siskop_owner;', database='postgres')
        sql('DROP SCHEMA public;', database=database)
        archive.seek(0)
        command(['docker', 'exec', '-i', CONTAINER, 'sh', '-c',
            'PGPASSWORD="$(cat /run/secrets/bootstrap-password)" exec pg_restore --no-owner --no-acl --exit-on-error --single-transaction --role=siskop_owner -U siskop_bootstrap -d ' + database], stdin=archive)
    runtime_grants(database)
    tables = json.loads(sql("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';", database=database))
    if set(tables) != set(manifest['tables']): raise ValueError('Restored table set differs')
    for table in tables:
        ident = '"' + table.replace('"', '""') + '"'
        actual = json.loads(sql("SET timezone='UTC'; SET datestyle='ISO,YMD'; SELECT json_build_object('rows',count(*),'content_md5',md5(coalesce(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public." + ident + ' t) hashes;', database=database))
        if actual != manifest['tables'][table]: raise ValueError('Restored content differs: ' + table)
    report = {'database': database, 'archive_sha256': sha, 'source_created': manifest['created_utc'], 'tables': len(tables), 'rows': sum(t['rows'] for t in manifest['tables'].values()), 'verified': True, 'traffic_switched': False}
    (ROOT / ('candidate-' + sha[:12] + '.json')).write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        raise SystemExit('SISKOP fresh restore stopped: ' + str(error)) from None
