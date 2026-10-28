#!/usr/bin/env python3
"""Decrypt and restore only into a new disposable local PostgreSQL cluster."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def run(command, **kwargs):
    result = subprocess.run(command, capture_output=True, **kwargs)
    if result.returncode:
        diagnostic = result.stderr.decode(errors="replace") if isinstance(result.stderr, bytes) else result.stderr
        # Object-definition errors are useful for portability; omit SQL/data lines.
        errors = [line for line in diagnostic.splitlines() if line.startswith("pg_restore: error:")]
        raise RuntimeError(f"{Path(command[0]).name} failed; exit {result.returncode}; " + " ".join(errors))
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", required=True)
    parser.add_argument("--private-key", required=True)
    parser.add_argument("--pg-bin", default="/opt/homebrew/opt/postgresql@17/bin")
    args = parser.parse_args()
    os.umask(0o077)
    backup = Path(args.backup).resolve(strict=True)
    key = Path(args.private_key).resolve(strict=True)
    checksums = json.loads((backup / "checksums.json").read_text())
    for name, expected in checksums.items():
        if Path(name).name != name or hashlib.sha256((backup / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Encrypted backup checksum mismatch")
    with tempfile.TemporaryDirectory(prefix="siskop-restore-") as temp:
        root = Path(temp)
        for encrypted, output in [("siskop.dump.cms", "siskop.dump"), ("manifest.json.cms", "manifest.json")]:
            run(["openssl", "cms", "-decrypt", "-binary", "-inform", "DER", "-in", str(backup / encrypted),
                 "-inkey", str(key), "-out", str(root / output)])
        manifest = json.loads((root / "manifest.json").read_text())
        if hashlib.sha256((root / "siskop.dump").read_bytes()).hexdigest() != manifest["dump_sha256"]:
            raise ValueError("Decrypted archive checksum mismatch")
        pg = Path(args.pg_bin)
        data = root / "cluster"
        socket = root / "socket"
        socket.mkdir()
        env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        env.update(PGHOST=str(socket), PGPORT="55439", PGDATABASE="siskop_restore_verify", PGUSER="siskop_verify",
                   PGOPTIONS="-c timezone=UTC -c datestyle=ISO,YMD")
        run([str(pg / "initdb"), "-D", str(data), "--username=siskop_verify", "--auth=trust", "--no-locale", "--encoding=UTF8"], env=env)
        started = False
        try:
            run([str(pg / "pg_ctl"), "-D", str(data), "-l", str(root / "postgres.log"),
                 "-o", f"-k {socket} -p 55439 -c listen_addresses=''", "-w", "start"], env=env)
            started = True
            run([str(pg / "createdb"), "--maintenance-db=postgres", "siskop_restore_verify"], env=env)
            # Destination backups contain policies for these NOLOGIN stand-ins.
            # This is a new disposable cluster; no shared host roles are touched.
            run([str(pg / "psql"), "-X", "-v", "ON_ERROR_STOP=1", "-c",
                 "CREATE ROLE siskop_runtime NOLOGIN NOBYPASSRLS; CREATE ROLE siskop_backup NOLOGIN NOBYPASSRLS;"], env=env)
            # This cluster was created above and contains no application objects.
            # The archive contains CREATE SCHEMA public, so remove the empty default.
            run([str(pg / "psql"), "-X", "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA public"], env=env)
            run([str(pg / "pg_restore"), "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction",
                 "--dbname=siskop_restore_verify", str(root / "siskop.dump")], env=env)
            differences = []
            for table, expected in manifest["tables"].items():
                ident = '"' + table.replace('"', '""') + '"'
                sql = ("SELECT json_build_object('rows',count(*),'content_md5',md5(coalesce(string_agg(h,'' ORDER BY h),''))) "
                       f"FROM (SELECT md5(to_jsonb(t)::text) h FROM public.{ident} t) hashes;")
                actual = json.loads(run([str(pg / "psql"), "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql], env=env, text=True))
                if actual != expected:
                    differences.append(table)
            if differences:
                raise ValueError("Restored table contents differ from the source snapshot: " + ", ".join(differences))
            report = {"verified": True, "tables": len(manifest["tables"]),
                      "rows": sum(x["rows"] for x in manifest["tables"].values()),
                      "dump_sha256": manifest["dump_sha256"], "target": "disposable-local-cluster",
                      "encryption": "CMS AES-256-GCM", "source_modified": False}
            (backup / "restore-verification.json").write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report))
        finally:
            if started:
                run([str(pg / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"], env=env)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"SISKOP restore verification stopped: {error}") from None
