import { createHash, randomUUID } from "node:crypto";
import { ErrorCode, type MigrationIssue, type MigrationPreview, type MigrationResult, type MigrationTarget } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { withManagedIdentity } from "../identity-provisioning/service.js";
import { runMigration, type ImportOutcome } from "./importer.js";
import { parseRows, type ParsedData } from "./rows.js";
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

interface TargetInfo extends MigrationTarget {
  /** A user of the target tenant; rows need a createdBy that belongs to the tenant. */
  adminUserId: string;
}

/**
 * Loads the koperasi chosen as migration target and reports why it cannot take the file:
 * it must exist, have an admin, hold no members/savings/loans/journal entries, and match the file's slug.
 */
async function inspectTarget(tenantId: string, data: ParsedData | null, issues: MigrationIssue[]): Promise<TargetInfo> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true } });
  if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, "Koperasi tujuan tidak ditemukan");
  const err = (sheet: string, column: string | null, message: string) => issues.push({ severity: "error", sheet, row: null, column, message });
  const warn = (sheet: string, column: string | null, message: string) => issues.push({ severity: "warning", sheet, row: null, column, message });

  const [members, savings, loans, entries, savingConfigs, loanConfigs, admin] = await Promise.all([
    db.member.count({ where: { tenantId } }),
    db.saving.count({ where: { tenantId } }),
    db.loan.count({ where: { tenantId } }),
    db.journalEntry.count({ where: { tenantId } }),
    db.savingConfig.count({ where: { tenantId } }),
    db.loanConfig.count({ where: { tenantId } }),
    db.user.findFirst({ where: { tenantId, isActive: true, role: { name: "Super Admin" } }, orderBy: { createdAt: "asc" }, select: { id: true } })
  ]);
  const filled = [
    members && `${members} anggota`,
    savings && `${savings} rekening simpanan`,
    loans && `${loans} pinjaman`,
    entries && `${entries} jurnal`
  ].filter(Boolean);
  if (filled.length) err("(koperasi tujuan)", null, `Koperasi tujuan sudah berisi data: ${filled.join(", ")}. Migrasi hanya untuk koperasi yang masih kosong.`);
  if (!admin) err("(koperasi tujuan)", null, "Koperasi tujuan belum punya admin aktif (role Super Admin).");
  if (savingConfigs + loanConfigs > 0) {
    warn("(koperasi tujuan)", null, `Koperasi tujuan sudah punya ${savingConfigs + loanConfigs} produk simpanan/pinjaman; produk dari file ditambahkan.`);
  }

  if (data) {
    const k = data.koperasi;
    if (k.slug !== tenant.slug) {
      err("1_Koperasi", "slug", `Subdomain di file (${k.slug}) berbeda dari koperasi tujuan (${tenant.slug}). Pastikan file ini untuk koperasi yang dipilih.`);
    }
    if (k.name.trim().toLowerCase() !== tenant.name.trim().toLowerCase()) {
      warn("1_Koperasi", "name", `Nama di file (${k.name}) berbeda dari koperasi tujuan (${tenant.name}). Data koperasi tujuan tidak diubah.`);
    }
    warn("1_Koperasi", "adminEmail", "Data admin di file diabaikan; koperasi tujuan memakai admin yang sudah ada.");
    const codes = data.extraAccounts.map((a) => a.code);
    if (codes.length) {
      const taken = new Set((await db.account.findMany({ where: { tenantId, code: { in: codes } }, select: { code: true } })).map((a) => a.code));
      for (const a of data.extraAccounts) {
        if (taken.has(a.code)) issues.push({ severity: "error", sheet: "10_Akun_Tambahan", row: a._row, column: "code", message: `Kode akun ${a.code} sudah ada di koperasi tujuan` });
      }
    }
  }
  return { tenantId: tenant.id, name: tenant.name, slug: tenant.slug, adminUserId: admin?.id ?? "" };
}

async function analyse(buffer: Buffer, tenantId?: string) {
  const read = await readWorkbook(buffer);
  const parsed = parseRows(read);
  const checked = parsed.data ? validateData(parsed.data) : null;
  const issues = [...parsed.issues, ...(checked?.issues ?? [])];
  let target: TargetInfo | null = null;
  if (tenantId) {
    target = await inspectTarget(tenantId, parsed.data, issues);
  } else if (parsed.data) {
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
  return { read, data: parsed.data, totals: checked?.totals ?? null, issues, target };
}

export async function previewMigration(buffer: Buffer, opts: { tenantId?: string } = {}): Promise<MigrationPreview> {
  const a = await analyse(buffer, opts.tenantId);
  const hasError = a.issues.some((i) => i.severity === "error");
  let opening: ImportOutcome["opening"] = [];
  if (a.data && !hasError) {
    const data = a.data;
    const target = a.target;
    try {
      await db.$transaction(async (tx) => {
        const outcome = await runMigration(
          tx,
          data,
          target
            ? { target: { tenantId: target.tenantId, adminUserId: target.adminUserId }, requestId: "migration-preview", actorUserId: null }
            : {
                // A local stub: the preview must never create a Firebase account, which a rollback cannot undo.
                identity: { id: randomUUID(), email: data.koperasi.adminEmail.toLowerCase(), passwordHash: null, firebaseUid: null, authProvider: null },
                requestId: "migration-preview",
                actorUserId: null
              }
        );
        throw new DryRun(outcome);
      }, TX);
    } catch (e) {
      if (e instanceof DryRun) opening = e.outcome.opening;
      else throw e;
    }
  }
  return {
    mode: a.read.mode,
    target: a.target ? { tenantId: a.target.tenantId, name: a.target.name, slug: a.target.slug } : null,
    fileHash: sha256(buffer),
    tenantName: a.target?.name ?? a.data?.koperasi.name ?? null,
    slug: a.target?.slug ?? a.data?.koperasi.slug ?? null,
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
  input: { fileHash: string; tenantId?: string; adminPassword?: string; actor: Actor }
): Promise<MigrationResult> {
  if (sha256(buffer) !== input.fileHash) {
    throw new AppError(ErrorCode.MIGRATION_PREVIEW_MISMATCH, "File berbeda dari yang dipratinjau. Unggah dan pratinjau ulang.");
  }
  // A new koperasi needs the first admin's password; an existing one keeps its admin.
  if (!input.tenantId && (input.adminPassword ?? "").length < 8) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Kata sandi admin minimal 8 karakter");
  }
  const a = await analyse(buffer, input.tenantId);
  if (!a.data || a.issues.some((i) => i.severity === "error")) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "File masih memuat kesalahan. Jalankan pratinjau dan perbaiki.");
  }

  const data = a.data;
  const common = {
    requestId: input.actor.requestId,
    actorUserId: input.actor.userId,
    ip: input.actor.ip,
    userAgent: input.actor.userAgent
  };
  const outcome = a.target
    ? await db.$transaction(
        (tx) => runMigration(tx, data, { ...common, target: { tenantId: a.target!.tenantId, adminUserId: a.target!.adminUserId } }),
        TX
      )
    : await withManagedIdentity(
        { email: data.koperasi.adminEmail, name: data.koperasi.adminName, password: input.adminPassword! },
        (identity, tx) => runMigration(tx, data, { ...common, identity }),
        TX
      );
  return { tenantId: outcome.tenantId, slug: outcome.slug, counts: outcome.counts, openingEntryNo: outcome.openingEntryNo, totals: a.totals! };
}
