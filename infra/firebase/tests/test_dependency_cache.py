from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import subprocess

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("dependency_cache", ROOT / "infra/firebase/dependency_cache.py")
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class DependencyCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        previous = Path.cwd()
        self.addCleanup(os.chdir, previous)
        os.chdir(self.temp.name)
        Path(".release").mkdir()
        Path("pnpm-lock.yaml").write_text("lockfileVersion: 9")
        Path("package.json").write_text('{"packageManager":"pnpm@11.19.0"}')
        Path(".release/verification.json").write_text(json.dumps({"mode": "reuse-ci", "commit": "a" * 40, "buildId": "build"}))
        env = patch.dict(os.environ, {"RELEASE_DEPLOY": "true", "RELEASE_BRANCH": "main", "RELEASE_COMMIT": "a" * 40, "RELEASE_BUILD_ID": "build"})
        env.start()
        self.addCleanup(env.stop)

    def run_cache(self, action):
        with redirect_stdout(io.StringIO()):
            cache.main(action)

    def store_file(self):
        file = cache.STORE / "v11/files/example"
        file.parent.mkdir(parents=True)
        file.write_text("downloaded package")
        file.chmod(0o755)
        return file

    def archive(self, name="v11/files/example", kind=tarfile.REGTYPE, data=b"package"):
        with tarfile.open(cache.ARCHIVE, "w:gz") as output:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = len(data) if kind == tarfile.REGTYPE else 0
            entry.linkname = "../../outside"
            output.addfile(entry, io.BytesIO(data) if entry.size else None)

    def test_source_changes_reuse_key_but_lock_manifest_and_scope_changes_do_not(self):
        original = cache.cache_key()
        Path("App.tsx").write_text("changed code")
        self.assertEqual(cache.cache_key(), original)
        self.assertNotEqual(cache.cache_key(scope="full"), original)
        for name in ["pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml", ".npmrc", "apps/frontend/package.json"]:
            with self.subTest(name=name):
                before = cache.cache_key()
                file = Path(name)
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("changed dependencies")
                self.assertNotEqual(cache.cache_key(), before)

    def test_manual_and_non_main_builds_never_contact_storage(self):
        for env in [{"RELEASE_DEPLOY": "false"}, {"RELEASE_BRANCH": "feature/test"}]:
            with patch.dict(os.environ, env), patch.object(cache, "copy_object") as copy:
                self.run_cache("restore")
                self.run_cache("save")
                copy.assert_not_called()

    def test_cold_cache_does_not_block_installation(self):
        with patch.object(cache, "copy_object", return_value=False):
            self.run_cache("restore")
        self.assertFalse(cache.STORE.exists())

    def test_network_timeout_is_optional(self):
        with patch.object(cache, "copy_object", side_effect=subprocess.TimeoutExpired("gcloud", 45)):
            self.run_cache("restore")
        self.assertFalse(cache.HIT.exists())

    def test_valid_archive_restores_only_store_and_marks_hit(self):
        def download(*args):
            self.archive()
            return True
        with patch.object(cache, "copy_object", side_effect=download):
            self.run_cache("restore")
        self.assertEqual((cache.STORE / "v11/files/example").read_text(), "package")
        self.assertEqual(cache.HIT.read_text(), cache.cache_key())
        self.assertFalse(cache.ARCHIVE.exists())

    def test_traversal_and_link_archives_are_discarded_before_install(self):
        for name, kind in [("../outside", tarfile.REGTYPE), ("/outside", tarfile.REGTYPE), ("file", tarfile.SYMTYPE), ("file", tarfile.LNKTYPE)]:
            with self.subTest(name=name, kind=kind):
                def download(*args):
                    self.archive(name, kind)
                    return True
                with patch.object(cache, "copy_object", side_effect=download):
                    self.run_cache("restore")
                self.assertFalse(cache.STORE.exists())
                self.assertFalse(cache.HIT.exists())
                self.assertFalse(Path("outside").exists())

    def test_corrupt_or_oversized_archives_fall_back_to_downloads(self):
        def corrupt(*args):
            cache.ARCHIVE.write_bytes(b"invalid gzip")
            return True
        with patch.object(cache, "copy_object", side_effect=corrupt):
            self.run_cache("restore")
        def download(*args):
            self.archive()
            return True
        with patch.object(cache, "copy_object", side_effect=download), patch.object(cache, "MAX_EXPANDED", 1):
            self.run_cache("restore")
        self.assertFalse(cache.STORE.exists())

    def test_save_contains_only_package_store_and_preserves_executable_files(self):
        self.store_file()
        Path(".env").write_text("must never enter cache")
        def upload(source, destination, upload=False):
            self.assertTrue(upload)
            self.assertTrue(destination.startswith(cache.BUCKET + "/"))
            with tarfile.open(source) as archive:
                names = archive.getnames()
                self.assertIn("v11/files/example", names)
                self.assertNotIn(".env", names)
                self.assertEqual(archive.getmember("v11/files/example").mode & 0o111, 0o111)
            return True
        with patch.object(cache, "copy_object", side_effect=upload):
            self.run_cache("save")
        self.assertFalse(cache.ARCHIVE.exists())

    def test_warm_cache_does_not_upload_again(self):
        self.store_file()
        cache.HIT.write_text(cache.cache_key())
        with patch.object(cache, "copy_object") as copy:
            self.run_cache("save")
            copy.assert_not_called()

    def test_upload_failure_does_not_fail_release(self):
        self.store_file()
        with patch.object(cache, "copy_object", return_value=False):
            self.run_cache("save")

    def test_upload_is_create_only_and_transfer_has_timeout(self):
        with patch.object(cache.subprocess, "run") as run:
            run.return_value.returncode = 0
            self.assertTrue(cache.copy_object("source", "destination", upload=True))
            self.assertIn("--if-generation-match=0", run.call_args.args[0])
            self.assertEqual(run.call_args.kwargs["timeout"], 45)

    def test_other_build_decision_cannot_restore_cache(self):
        with patch.dict(os.environ, {"RELEASE_BUILD_ID": "other"}), patch.object(cache, "copy_object") as copy:
            with self.assertRaises(ValueError):
                self.run_cache("restore")
            copy.assert_not_called()


if __name__ == "__main__":
    unittest.main()
