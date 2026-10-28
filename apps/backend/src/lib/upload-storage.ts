import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorage } from "firebase-admin/storage";
import { firebaseAuth } from "../modules/onboarding/firebase.js";
import { AppError } from "./errors.js";
import { ErrorCode } from "@siskop/types";
import { sniffFileType } from "./file-sniff.js";

const contentTypes = { jpg: "image/jpeg", png: "image/png", pdf: "application/pdf" };

export function uploadBucket(): ReturnType<ReturnType<typeof getStorage>["bucket"]> {
  if (process.env.STORAGE_BUCKET !== "siskop-d0f8c-staging-uploads") {
    throw new Error("Unexpected SISKOP upload bucket");
  }
  return getStorage(firebaseAuth().app).bucket(process.env.STORAGE_BUCKET);
}

/** Retain existing object keys and URLs; acknowledge only durable writes. */
export async function saveKtp(tenantId: string, buffer: Buffer): Promise<string> {
  const type = sniffFileType(buffer);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tenantId) || !type || buffer.length > 2 * 1024 * 1024) {
    throw new AppError(ErrorCode.INVALID_FILE_TYPE, "File KTP tidak valid");
  }
  const key = `ktp/${tenantId}/${randomUUID()}.${type}`;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "gcs") {
    await uploadBucket().file(key).save(buffer, {
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: contentTypes[type], cacheControl: "private, no-store" }
    });
  } else if (driver === "local") {
    const destination = path.resolve(process.env.STORAGE_PATH ?? "./uploads", key);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, buffer, { flag: "wx", mode: 0o600 });
  } else {
    throw new Error("Unsupported upload storage driver");
  }
  return `/uploads/${key}`;
}
