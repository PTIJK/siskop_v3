import base64
import importlib.util
import pathlib
import unittest
import uuid

SPEC = importlib.util.spec_from_file_location("release_id", pathlib.Path(__file__).parents[1] / "release_id.py")
release_id = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release_id)


class TenantResourceIdTests(unittest.TestCase):
    def test_stable_known_encoding(self):
        build = "12345678-1234-1234-1234-123456789abc"
        expected = "cb-ci2fm6asgqjdieruci2fm6e2xq"
        self.assertEqual(release_id.tenant_resource_id(build), expected)
        self.assertEqual(release_id.tenant_resource_id(build), expected)

    def test_full_uuid_round_trip_and_api_length(self):
        builds = [uuid.UUID(int=0), uuid.UUID(int=(1 << 128) - 1),
                  uuid.UUID("a1a84d5c-8821-4d81-9267-c6d68e676a1d")]
        # Flipping every UUID bit verifies that neither prefix nor suffix is lost.
        builds += [uuid.UUID(int=1 << bit) for bit in range(128)]
        identifiers = []
        for build in builds:
            with self.subTest(build=str(build)):
                identifier = release_id.tenant_resource_id(str(build))
                self.assertEqual(len(identifier), 29)
                self.assertLessEqual(len(identifier), 30)
                self.assertRegex(identifier, r"^cb-[a-z2-7]{26}$")
                decoded = base64.b32decode(identifier[3:].upper() + "======")
                self.assertEqual(uuid.UUID(bytes=decoded), build)
                identifiers.append(identifier)
        self.assertEqual(len(set(identifiers)), len(builds))

    def test_noncanonical_or_invalid_uuid_is_rejected(self):
        for build in [None, 123, "", "not-a-uuid", "12345678123412341234123456789abc",
                      "12345678-1234-1234-1234-123456789ABC",
                      "12345678-1234-1234-1234-123456789abc\n",
                      "{12345678-1234-1234-1234-123456789abc}"]:
            with self.subTest(build=build), self.assertRaisesRegex(ValueError, "exact Cloud Build UUID"):
                release_id.tenant_resource_id(build)


if __name__ == "__main__":
    unittest.main()
