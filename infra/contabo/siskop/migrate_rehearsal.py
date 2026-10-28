#!/usr/bin/env python3
"""Prove migration ownership and rollback only in an identified SISKOP candidate."""
import argparse
import json
import os
import re
import tempfile
from siskopctl import ROOT, validate_root, validate_container, command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'siskop_cutover_[a-f0-9]{12}', args.database):
        raise ValueError('Migration rehearsal requires a separate SISKOP candidate database')
    validate_root(); validate_container(); os.umask(0o077)
    report = json.loads((ROOT / ('candidate-' + args.database.removeprefix('siskop_cutover_') + '.json')).read_text())
    if report.get('database') != args.database or report.get('verified') is not True: raise ValueError('Candidate must pass restore verification')
    settings = dict(line.split('=', 1) for line in (ROOT / 'compose.env').read_text().splitlines() if line and not line.startswith('#'))
    with tempfile.TemporaryDirectory(prefix='migration-rehearsal-', dir=ROOT) as folder:
        env = ROOT / folder / 'migration.env'
        password = (ROOT / 'secrets/migration-password').read_text().strip()
        env.write_text('DATABASE_URL=postgresql://siskop_migration:' + password + '@postgres:5432/' + args.database + '?connection_limit=1\nNODE_ENV=production\n')
        prefix = ['docker', 'run', '--rm', '-i', '--name', 'siskop-migrate-rehearsal', '--network', 'siskop-staging-database',
            '--label', 'com.siskop.application=siskop', '--user', '1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
            '--cpus=1', '--memory=512m', '--memory-swap=512m', '--pids-limit=128', '--tmpfs', '/tmp:size=64m,uid=1000,gid=1000,mode=1777',
            '--env-file', str(env), settings['SISKOP_API_IMAGE']]
        probe = '''import {db} from './apps/backend/dist/lib/db.js';
try {
 const [role]=await db.$queryRawUnsafe('SELECT current_user AS role,session_user AS login');
 if(role.role!=='siskop_owner'||role.login!=='siskop_migration') throw new Error('Wrong migration role');
 try {await db.$transaction(async tx=>{await tx.$executeRawUnsafe('CREATE TABLE public.siskop_migration_rollback_probe(id integer)'); throw new Error('expected-rollback');});}
 catch(error){if(error.message!=='expected-rollback') throw error;}
 const [exists]=await db.$queryRawUnsafe("SELECT to_regclass('public.siskop_migration_rollback_probe') IS NOT NULL AS present");
 if(exists.present) throw new Error('DDL rollback failed');
} finally {await db.$disconnect();}
'''
        command(prefix + ['node', '--input-type=module'], input=probe.encode(), timeout=60)
        command(prefix + ['node', '/app/apps/backend/node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema=/app/apps/backend/prisma/schema.prisma'], timeout=600)
    print(json.dumps({'database': args.database, 'migration_role': 'siskop_owner via siskop_migration', 'ddl_rollback_verified': True, 'prisma_migrate_deploy': True}))


if __name__ == '__main__':
    try: main()
    except Exception as error: raise SystemExit('SISKOP migration rehearsal stopped: ' + str(error)) from None
