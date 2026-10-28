import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), file: vi.fn(), bucket: vi.fn() }));
vi.mock("firebase-admin/storage", () => ({ getStorage: () => ({ bucket: mocks.bucket }) }));
vi.mock("../src/modules/onboarding/firebase.js", () => ({ firebaseAuth: () => ({ app: {} }) }));
import { saveKtp } from "../src/lib/upload-storage.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("portable upload storage", () => {
  it("writes local uploads under the same tenant URL layout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "siskop-upload-test-"));
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("STORAGE_PATH", root);
    try {
      const url = await saveKtp("tenant_a", jpeg);
      expect(url).toMatch(/^\/uploads\/ktp\/tenant_a\/[a-f0-9-]+\.jpg$/);
      expect(await readFile(path.join(root, url.slice("/uploads/".length)))).toEqual(jpeg);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("stores private objects in the allowlisted existing SISKOP bucket", async () => {
    vi.stubEnv("STORAGE_DRIVER", "gcs");
    vi.stubEnv("STORAGE_BUCKET", "siskop-d0f8c-staging-uploads");
    mocks.bucket.mockReturnValue({ file: mocks.file });
    mocks.file.mockReturnValue({ save: mocks.save });
    mocks.save.mockResolvedValue(undefined);
    const url = await saveKtp("tenant_a", jpeg);
    expect(mocks.bucket).toHaveBeenCalledWith("siskop-d0f8c-staging-uploads");
    expect(mocks.file).toHaveBeenCalledWith(url.slice("/uploads/".length));
    expect(mocks.save).toHaveBeenCalledWith(jpeg, expect.objectContaining({
      validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "image/jpeg", cacheControl: "private, no-store" }
    }));
  });
  it("does not acknowledge a failed cloud write", async () => {
    vi.stubEnv("STORAGE_DRIVER", "gcs");
    vi.stubEnv("STORAGE_BUCKET", "siskop-d0f8c-staging-uploads");
    mocks.bucket.mockReturnValue({ file: mocks.file });
    mocks.file.mockReturnValue({ save: mocks.save });
    mocks.save.mockRejectedValue(new Error("storage unavailable"));
    await expect(saveKtp("tenant_a", jpeg)).rejects.toThrow("storage unavailable");
  });
  it("rejects other buckets, invalid content and path traversal", async () => {
    vi.stubEnv("STORAGE_DRIVER", "gcs");
    vi.stubEnv("STORAGE_BUCKET", "sentryx-uploads");
    await expect(saveKtp("tenant_a", jpeg)).rejects.toThrow("Unexpected SISKOP upload bucket");
    await expect(saveKtp("../another-app", jpeg)).rejects.toThrow("File KTP tidak valid");
    await expect(saveKtp("tenant_a", Buffer.from("fake image"))).rejects.toThrow("File KTP tidak valid");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
