#!/usr/bin/env python3
"""Restore stdin into the positively identified EMPTY SISKOP destination only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from siskopctl import ROOT, CONTAINER, validate_root, sql, command


def provision_roles():
    statements = ['CREATE ROLE siskop_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;']
    for name, file in [('siskop_runtime', 'runtime'), ('siskop_migration', 'migration'), ('siskop_backup', 'backup')]:
        password = (ROOT / f'secrets/{file}-password').read_text().strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{40,80}', password):
            raise ValueError('Unexpected SISKOP credential encoding')
        statements.append(f"CREATE ROLE {name} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;")
    statements.extend([
        'REVOKE ALL ON DATABASE siskop_staging FROM PUBLIC;',
        'GRANT CONNECT ON DATABASE siskop_staging TO siskop_runtime, siskop_migration, siskop_backup;',
        'ALTER DATABASE siskop_staging OWNER TO siskop_owner;',
        'GRANT siskop_owner TO siskop_migration;',
        'ALTER ROLE siskop_migration IN DATABASE siskop_staging SET role = siskop_owner;',
        'DROP SCHEMA public;',
    ])
    sql('BEGIN;\n' + '\n'.join(statements) + '\nCOMMIT;')


def runtime_grants():
    sql('''BEGIN;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO siskop_runtime, siskop_backup;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO siskop_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO siskop_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO siskop_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO siskop_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO siskop_backup;
REVOKE ALL ON public._prisma_migrations FROM siskop_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE siskop_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO siskop_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE siskop_owner IN SCHEMA public GRANT SELECT ON TABLES TO siskop_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE siskop_owner IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO siskop_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE siskop_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO siskop_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE siskop_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE siskop_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO siskop_runtime;
DO $policies$
DECLARE t record;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
   IF t.tablename <> '_prisma_migrations' THEN
     EXECUTE format('CREATE POLICY siskop_backend_access ON public.%I TO siskop_runtime USING (true) WITH CHECK (true)',t.tablename);
   END IF;
   EXECUTE format('CREATE POLICY siskop_backup_read ON public.%I FOR SELECT TO siskop_backup USING (true)',t.tablename);
 END LOOP;
END
$policies$;
COMMIT;''')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{64}', args.sha256):
        raise ValueError('Archive SHA256 required')
    validate_root()
    if sql("SELECT current_database() || ':' || (SELECT count(*) FROM pg_tables WHERE schemaname='public');").strip() != 'siskop_staging:0':
        raise ValueError('Refusing nonempty destination; this operation never overwrites application data')
    if sql("SELECT count(*) FROM pg_roles WHERE rolname IN ('siskop_owner','siskop_runtime','siskop_migration','siskop_backup');").strip() != '0':
        raise ValueError('Destination already provisioned; inspect any interrupted restore manually')
    os.umask(0o077)
    with tempfile.TemporaryFile(dir=ROOT) as archive:
        digest = hashlib.sha256()
        total = 0
        while chunk := sys.stdin.buffer.read(1024 * 1024):
            total += len(chunk)
            if total > 1024 * 1024 * 1024:
                raise ValueError('Initial export exceeds reviewed 1 GiB limit')
            digest.update(chunk)
            archive.write(chunk)
        if digest.hexdigest() != args.sha256:
            raise ValueError('Incoming archive checksum mismatch')
        archive.seek(0)
        provision_roles()
        archive.seek(0)
        command(['docker', 'exec', '-i', CONTAINER, 'sh', '-c',
                 'PGPASSWORD="$(cat /run/secrets/bootstrap-password)" exec pg_restore --no-owner --no-acl --exit-on-error --single-transaction --role=siskop_owner -U siskop_bootstrap -d siskop_staging'], stdin=archive)
    runtime_grants()
    (ROOT / 'initial-restore.json').write_text(json.dumps({'archive_sha256': args.sha256, 'source': 'siskop-supabase', 'cutover': False}))
    print(json.dumps({'restored': 'siskop_staging', 'source_sha256': args.sha256, 'traffic_switched': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'SISKOP initial restore stopped: {error}') from None
