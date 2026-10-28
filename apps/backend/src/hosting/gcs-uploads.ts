import type { RequestHandler } from "express";
import { uploadBucket } from "../lib/upload-storage.js";

/** Preserve legacy upload paths without making the bucket publicly readable. */
export function gcsUploads(): RequestHandler {
  return (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) { res.sendStatus(405); return; }
    const key = req.path.replace(/^\//, "");
    if (!/^ktp\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_.-]{1,200}\.(jpg|jpeg|png|pdf)$/.test(key) || key.includes("..")) {
      res.sendStatus(404); return;
    }
    void (async () => {
      const file = uploadBucket().file(key);
      const [metadata] = await file.getMetadata();
      res.set("Cache-Control", "private, no-store");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.set("Content-Type", key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".png") ? "image/png" : "image/jpeg");
      if (metadata.size !== undefined) res.set("Content-Length", String(metadata.size));
      if (req.method === "HEAD") { res.end(); return; }
      const stream = file.createReadStream({ validation: "crc32c" });
      stream.on("error", () => { if (!res.headersSent) res.sendStatus(502); else res.destroy(); });
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    })().catch((error: { code?: number }) => {
      if (error.code === 404) res.sendStatus(404); else next(error);
    });
  };
}
