import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ metadata: vi.fn(), stream: vi.fn(), file: vi.fn() }));
vi.mock("../src/lib/upload-storage.js", () => ({ uploadBucket: () => ({ file: mocks.file }) }));
import { gcsUploads } from "../src/hosting/gcs-uploads.js";

function app() {
  const server = express();
  server.use("/uploads", gcsUploads());
  server.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.sendStatus(500));
  return server;
}
afterEach(() => vi.resetAllMocks());
describe("existing GCS upload URLs", () => {
  it("streams private objects with the existing relative path", async () => {
    mocks.file.mockReturnValue({ getMetadata: mocks.metadata, createReadStream: mocks.stream });
    mocks.metadata.mockResolvedValue([{ size: 3 }]);
    mocks.stream.mockReturnValue(Readable.from(Buffer.from("abc")));
    const response = await request(app()).get("/uploads/ktp/tenant_a/existing-file.jpg");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(Buffer.from("abc"));
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(mocks.file).toHaveBeenCalledWith("ktp/tenant_a/existing-file.jpg");
  });
  it("serves HEAD without downloading an object body", async () => {
    mocks.file.mockReturnValue({ getMetadata: mocks.metadata, createReadStream: mocks.stream });
    mocks.metadata.mockResolvedValue([{ size: 100 }]);
    expect((await request(app()).head("/uploads/ktp/tenant_a/existing-file.pdf")).status).toBe(200);
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it("rejects non-application object paths before accessing storage", async () => {
    for (const url of ["/uploads/config.json", "/uploads/ktp/tenant_a/name..jpg", "/uploads/ktp/tenant_a/script.html"])
      expect((await request(app()).get(url)).status).toBe(404);
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it("returns a missing-object response without leaking provider diagnostics", async () => {
    mocks.file.mockReturnValue({ getMetadata: mocks.metadata });
    mocks.metadata.mockRejectedValue({ code: 404, message: "internal bucket details" });
    const response = await request(app()).get("/uploads/ktp/tenant_a/absent.jpg");
    expect(response.status).toBe(404);
    expect(response.text).not.toContain("bucket");
  });
});
