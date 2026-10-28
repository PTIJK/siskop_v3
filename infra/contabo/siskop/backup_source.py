#!/usr/bin/env python3
"""Read-only, snapshot-consistent SISKOP export. Never accepts arbitrary DB URLs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlparse, unquote

SOURCE_HOST = "aws-0-ap-southeast-1.pooler.supabase.com"
SOURCE_USER = "postgres.lovtfdddtafuyldnkbny"


def source_environment(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    parsed = urlparse(values["DATABASE_URL"])
    if (parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname != SOURCE_HOST
            or parsed.port != 5432 or unquote(parsed.username or "") != SOURCE_USER
            or parsed.path != "/postgres" or not parsed.password):
        raise ValueError("Refusing a source other than the SISKOP Singapore project")
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGHOST=SOURCE_HOST, PGPORT="5432", PGDATABASE="postgres",
               PGUSER=SOURCE_USER, PGPASSWORD=unquote(parsed.password),
               PGSSLMODE="require", PGCONNECT_TIMEOUT="20", PGAPPNAME="siskop-readonly-backup",
               PGOPTIONS="-c timezone=UTC -c datestyle=ISO,YMD")
    return env


def checked(command, **kwargs):
    result = subprocess.run(command, capture_output=True, **kwargs)
    if result.returncode:
        # Connection errors can contain credentials or source data. Never print them.
        raise RuntimeError(f"{Path(command[0]).name} failed; exit {result.returncode}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-env", required=True)
    parser.add_argument("--output", required=True, help="New private directory outside Git tracking")
    parser.add_argument("--recipient", required=True, help="Existing backup encryption certificate")
    args = parser.parse_args()
    os.umask(0o077)
    target = Path(args.output).resolve()
    target.mkdir(parents=True, exist_ok=False)
    env = source_environment(args.source_env)
    recipient = Path(args.recipient).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="siskop-export-") as temp:
        dump = Path(temp) / "siskop.dump"
        session = subprocess.Popen(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                                   env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, text=True)

        def query(sql):
            session.stdin.write(sql + "\n")
            session.stdin.flush()
            line = session.stdout.readline()
            if not line:
                raise RuntimeError("Read-only backup snapshot connection failed")
            return line.strip()

        try:
            snapshot = query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();")
            metadata = json.loads(query("SELECT json_build_object('version',current_setting('server_version'),'database',current_database(),'schemas',(SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'),'extensions',(SELECT json_agg(json_build_object('name',extname,'schema',n.nspname)) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),'large_objects',(SELECT count(*) FROM pg_largeobject_metadata));"))
            if not metadata["version"].startswith("17."):
                raise RuntimeError("Source major version changed; review backup compatibility")
            if metadata["large_objects"]:
                raise RuntimeError("Large objects require explicit dependency review before export")
            tables = json.loads(query("SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public';"))
            if not {"Tenant", "User", "_prisma_migrations"}.issubset(tables):
                raise RuntimeError("Source does not match expected SISKOP schema")
            manifest = {"source_project": "lovtfdddtafuyldnkbny", "created_utc": datetime.now(timezone.utc).isoformat(),
                        "metadata": metadata, "tables": {}}
            for table in tables:
                ident = '"' + table.replace('"', '""') + '"'
                manifest["tables"][table] = json.loads(query(
                    "SELECT json_build_object('rows',count(*),'content_md5',md5(coalesce(string_agg(h,'' ORDER BY h),''))) "
                    f"FROM (SELECT md5(to_jsonb(t)::text) h FROM public.{ident} t) hashes;"))
            checked(["pg_dump", "--no-password", "--format=custom", "--schema=public", "--no-acl",
                     "--lock-wait-timeout=10s", f"--snapshot={snapshot}", f"--file={dump}"], env=env)
            session.stdin.write("COMMIT;\n\\q\n")
            session.stdin.flush()
            session.wait(timeout=20)
            if session.returncode:
                raise RuntimeError("Snapshot session did not complete cleanly")
            manifest["dump_sha256"] = hashlib.sha256(dump.read_bytes()).hexdigest()
            contents = checked(["pg_restore", "--list", str(dump)], text=True)
            (target / "archive-contents.txt").write_text(contents)
            manifest_path = Path(temp) / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
            for source, output in [(dump, "siskop.dump.cms"), (manifest_path, "manifest.json.cms")]:
                checked(["openssl", "cms", "-encrypt", "-aes-256-gcm", "-binary", "-outform", "DER",
                         "-in", str(source), "-out", str(target / output), str(recipient)])
            checksums = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in target.iterdir() if f.is_file()}
            (target / "checksums.json").write_text(json.dumps(checksums, indent=2) + "\n")
            print(json.dumps({"backup": str(target), "tables": len(tables),
                              "rows": sum(t["rows"] for t in manifest["tables"].values()),
                              "encrypted": True, "consistent_snapshot": True}))
        finally:
            if session.poll() is None:
                session.kill()
                session.wait()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"SISKOP backup stopped: {error}") from None
