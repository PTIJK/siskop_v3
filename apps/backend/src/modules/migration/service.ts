import { createHash, randomUUID } from "node:crypto";
import { ErrorCode, type MigrationPreview, type MigrationResult } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { withManagedIdentity } from "../identity-provisioning/service.js";
import { runMigration, type ImportOutcome } from "./importer.js";
import { parseRows } from "./rows.js";
import { validateData } from "./validate.js";
import { readWorkbook } from "./workbook.js";

/** Thrown inside the preview transaction to force the rollback; carries what the dry run produced. */
class DryRun extends Error {
  constructor(readonly outcome: ImportOutcome) {
    super("dry run");
  }
}

const TX = { timeout: 10 * 60 * 1000, maxWait: 30_000 } as const;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export interface Actor {
  userId: string;
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
}

async function analyse(buffer: Buffer) {
  const read = await readWorkbook(buffer);
  const parsed = parseRows(read);
  const checked = parsed.data ? validateData(parsed.data) : null;
  const issues = [...parsed.issues, ...(checked?.issues ?? [])];
  if (parsed.data) {
    const k = parsed.data.koperasi;
    const clash = await withoutTenantScope(() =>
      db.tenant.findFirst({ where: { OR: [{ slug: k.slug }, { registrationNo: k.registrationNo }] }, select: { slug: true, registrationNo: true } })
    );
    if (clash?.slug === k.slug) {
      issues.push({ severity: "error", sheet: "1_Koperasi", row: null, column: "slug", message: `Subdomain ${k.slug} sudah dipakai koperasi lain` });
    } else if (clash) {
      issues.push({ severity: "error", sheet: "1_Koperasi", row: null, column: "registrationNo", message: "Nomor badan hukum sudah terdaftar" });
    }
    const email = await withoutTenantScope(() => db.user.findFirst({ where: { email: k.adminEmail.toLowerCase() }, select: { id: true } }));
    if (email) {
      issues.push({
        severity: "warning",
        sheet: "1_Koperasi",
        row: null,
        column: "adminEmail",
        message: "Email ini sudah punya akun di koperasi lain; akun baru tetap dibuat untuk koperasi ini."
      });
    }
  }
  return { read, data: parsed.data, totals: checked?.totals ?? null, issues };
}

export async function previewMigration(buffer: Buffer): Promise<MigrationPreview> {
  const a = await analyse(buffer);
  const hasError = a.issues.some((i) => i.severity === "error");
  let opening: ImportOutcome["opening"] = [];
  if (a.data && !hasError) {
    const data = a.data;
    try {
      await db.$transaction(async (tx) => {
        const outcome = await runMigration(tx, data, {
          // A local stub: the preview must never create a Firebase account, which a rollback cannot undo.
          identity: { id: randomUUID(), email: data.koperasi.adminEmail.toLowerCase(), passwordHash: null, firebaseUid: null, authProvider: null },
          requestId: "migration-preview",
          actorUserId: null
        });
        throw new DryRun(outcome);
      }, TX);
    } catch (e) {
      if (e instanceof DryRun) opening = e.outcome.opening;
      else throw e;
    }
  }
  return {
    mode: a.read.mode,
    fileHash: sha256(buffer),
    tenantName: a.data?.koperasi.name ?? null,
    slug: a.data?.koperasi.slug ?? null,
    cutoffDate: a.data?.koperasi.cutoffDate ?? null,
    counts: Object.entries(a.read.sheets).map(([sheet, rows]) => ({ sheet, rows: rows.length })),
    totals: a.totals,
    openingEntry: opening,
    issues: a.issues,
    canExecute: !hasError && a.data !== null
  };
}

export async function executeMigration(
  buffer: Buffer,
  input: { fileHash: string; adminPassword: string; actor: Actor }
): Promise<MigrationResult> {
  if (sha256(buffer) !== input.fileHash) {
    throw new AppError(ErrorCode.MIGRATION_PREVIEW_MISMATCH, "File berbeda dari yang dipratinjau. Unggah dan pratinjau ulang.");
  }
  if (input.adminPassword.length < 8) throw new AppError(ErrorCode.VALIDATION_ERROR, "Kata sandi admin minimal 8 karakter");
  const a = await analyse(buffer);
  if (!a.data || a.issues.some((i) => i.severity === "error")) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "File masih memuat kesalahan. Jalankan pratinjau dan perbaiki.");
  }

  const data = a.data;
  const outcome = await withManagedIdentity(
    { email: data.koperasi.adminEmail, name: data.koperasi.adminName, password: input.adminPassword },
    (identity, tx) =>
      runMigration(tx, data, {
        identity,
        requestId: input.actor.requestId,
        actorUserId: input.actor.userId,
        ip: input.actor.ip,
        userAgent: input.actor.userAgent
      }),
    TX
  );
  return { tenantId: outcome.tenantId, slug: outcome.slug, counts: outcome.counts, openingEntryNo: outcome.openingEntryNo, totals: a.totals! };
}
