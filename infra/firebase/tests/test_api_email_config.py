import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
IMAGE = "asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:" + "a" * 64


class ApiEmailConfigurationTests(unittest.TestCase):
    def deploy(self, hosting):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            log = root / "calls.jsonl"
            gcloud = root / "gcloud"
            gcloud.write_text("""#!/usr/bin/env python3
import json,os,sys
with open(os.environ['COMMAND_LOG'],'a') as output:
    output.write(json.dumps(sys.argv[1:])+'\\n')
""")
            gcloud.chmod(0o755)
            result = subprocess.run(["bash", "infra/firebase/deploy-api.sh", IMAGE, "--no-traffic"],
                cwd=ROOT, capture_output=True, text=True, env={**os.environ,
                    "PATH": str(root) + os.pathsep + os.environ["PATH"], "COMMAND_LOG": str(log),
                    "RELEASE_TENANT_HOSTING": hosting, "RELEASE_TENANT_LOGIN_SELECTION_ENABLED": hosting,
                    "RELEASE_TENANT_SWITCHING_ENABLED": "false", "RELEASE_TENANT_RENAME_ENABLED": "false"})
            self.assertEqual(result.returncode, 0, result.stderr)
            args = json.loads(log.read_text().splitlines()[0])
            flags = (ROOT / next(arg.split("=", 1)[1] for arg in args if arg.startswith("--flags-file="))).read_text()
            return args, flags

    def test_deploy_updates_plain_environment_without_clearing_secret_bindings(self):
        for hosting in ("true", "false"):
            with self.subTest(hosting=hosting):
                args, flags = self.deploy(hosting)
                self.assertFalse(any(arg.startswith(("--env-vars-file", "--set-env-vars", "--clear-env-vars")) for arg in args))
                self.assertTrue(flags.startswith("--update-env-vars:\n"))
                self.assertIn("  PUBLIC_APP_URL: https://siskop-d0f8c.web.app", flags)
                self.assertIn(f'  TENANT_DOMAINS_ENABLED: "{hosting}"', flags)
                self.assertIn(f'  TENANT_LOGIN_SELECTION_ENABLED: "{hosting}"', flags)
                self.assertIn('  TENANT_SWITCHING_ENABLED: "false"', flags)
                self.assertIn('  TENANT_DOMAIN_RENAME_ENABLED: "false"', flags)
                self.assertTrue(any(arg.startswith("--update-secrets=DATABASE_URL=") for arg in args))
                self.assertIn("--no-traffic", args)


if __name__ == "__main__":
    unittest.main()
