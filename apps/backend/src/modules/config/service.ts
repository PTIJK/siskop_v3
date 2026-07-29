import type { Prisma } from "@prisma/client";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import type {
  CreateAccountInput,
  CreateRoleInput,
  CreateUnitInput,
  UpdateAccountInput,
  UpdateModalDisetorInput,
  UpdateRoleInput,
  UpdateUnitInput,
  UpsertAccountMappingInput,
  UpsertShuDistributionConfigInput,
  UpsertWhitelabelConfigInput
} from "./schema.js";

// ── Units ────────────────────────────────────────────────────────────────────

export async function listUnits(tenantId: string) {
  return db.cooperativeUnit.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
}

export async function createUnit(tenantId: string, data: CreateUnitInput) {
  return db.cooperativeUnit.create({
    data: { tenantId, type: data.type, name: data.name, isActive: true }
  });
}

export async function updateUnit(tenantId: string, id: string, data: UpdateUnitInput) {
  const unit = await db.cooperativeUnit.findFirst({ where: { id, tenantId } });
  if (!unit) throw notFound("Unit koperasi tidak ditemukan");

  // CLAUDE.md rule 2b: every tenant has >=1 CooperativeUnit at all times.
  if (data.isActive === false && unit.isActive) {
    const activeCount = await db.cooperativeUnit.count({ where: { tenantId, isActive: true } });
    if (activeCount <= 1) throw conflict("Koperasi harus memiliki minimal 1 unit aktif");
  }

  return db.cooperativeUnit.update({ where: { id }, data });
}

// ── Roles ────────────────────────────────────────────────────────────────────

export async function listRoles(tenantId: string) {
  return db.role.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
}

export async function createRole(tenantId: string, data: CreateRoleInput) {
  return db.role.create({
    data: { tenantId, name: data.name, permissions: data.permissions as unknown as Prisma.InputJsonValue }
  });
}

export async function updateRole(tenantId: string, id: string, data: UpdateRoleInput) {
  const role = await db.role.findFirst({ where: { id, tenantId } });
  if (!role) throw notFound("Role tidak ditemukan");

  return db.role.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.permissions !== undefined
        ? { permissions: data.permissions as unknown as Prisma.InputJsonValue }
        : {})
    }
  });
}

export async function deleteRole(tenantId: string, id: string): Promise<void> {
  const role = await db.role.findFirst({ where: { id, tenantId } });
  if (!role) throw notFound("Role tidak ditemukan");

  const usersCount = await db.user.count({ where: { roleId: id } });
  if (usersCount > 0) {
    throw conflict("Role masih digunakan oleh pengguna aktif — pindahkan pengguna ke role lain terlebih dahulu");
  }

  await db.role.delete({ where: { id } });
}

// ── Accounts (Chart of Accounts) ───────────────────────────────────────────────

export async function listAccounts(tenantId: string) {
  return db.account.findMany({ where: { tenantId }, orderBy: { code: "asc" } });
}

export async function createAccount(tenantId: string, data: CreateAccountInput) {
  const duplicate = await db.account.findFirst({ where: { tenantId, code: data.code } });
  if (duplicate) throw conflict(`Kode akun ${data.code} sudah digunakan`);

  if (data.parentId) {
    const parent = await db.account.findFirst({ where: { id: data.parentId, tenantId } });
    if (!parent) throw notFound("Akun induk tidak ditemukan");
  }

  return db.account.create({
    data: {
      tenantId,
      code: data.code,
      name: data.name,
      category: data.category,
      normalBalance: data.normalBalance,
      parentId: data.parentId ?? null,
      isHeader: data.isHeader,
      isCashEquivalent: data.isCashEquivalent,
      isDefault: false,
      isActive: true
    }
  });
}

export async function updateAccount(tenantId: string, id: string, data: UpdateAccountInput) {
  const account = await db.account.findFirst({ where: { id, tenantId } });
  if (!account) throw notFound("Akun tidak ditemukan");

  if (data.code !== undefined && data.code !== account.code) {
    const duplicate = await db.account.findFirst({ where: { tenantId, code: data.code, NOT: { id } } });
    if (duplicate) throw conflict(`Kode akun ${data.code} sudah digunakan`);
  }

  if (data.parentId) {
    const parent = await db.account.findFirst({ where: { id: data.parentId, tenantId } });
    if (!parent) throw notFound("Akun induk tidak ditemukan");
  }

  if (data.isActive === false && account.isActive) {
    const [childCount, mappingCount, journalLineCount] = await Promise.all([
      db.account.count({ where: { parentId: id } }),
      db.accountMapping.count({ where: { OR: [{ debitAccountId: id }, { creditAccountId: id }] } }),
      db.journalLine.count({ where: { accountId: id } })
    ]);
    if (childCount > 0) throw conflict("Akun ini masih memiliki akun anak — nonaktifkan akun anak terlebih dahulu");
    if (mappingCount > 0) {
      throw conflict("Akun ini masih digunakan pada pemetaan akun — hapus pemetaannya terlebih dahulu");
    }
    if (journalLineCount > 0) {
      throw conflict("Akun ini sudah memiliki transaksi jurnal dan tidak dapat dinonaktifkan");
    }
  }

  return db.account.update({
    where: { id },
    data: {
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.normalBalance !== undefined ? { normalBalance: data.normalBalance } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      ...(data.isHeader !== undefined ? { isHeader: data.isHeader } : {}),
      ...(data.isCashEquivalent !== undefined ? { isCashEquivalent: data.isCashEquivalent } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
    }
  });
}

// ── Account Mappings ─────────────────────────────────────────────────────────

export async function listAccountMappings(tenantId: string) {
  const mappings = await db.accountMapping.findMany({
    where: { tenantId },
    include: { debitAccount: true, creditAccount: true },
    orderBy: { createdAt: "asc" }
  });

  const configIds = mappings.filter((m) => m.sourceId).map((m) => m.sourceId as string);
  const [savingConfigs, loanConfigs] = await Promise.all([
    db.savingConfig.findMany({ where: { tenantId, id: { in: configIds } } }),
    db.loanConfig.findMany({ where: { tenantId, id: { in: configIds } } })
  ]);
  const nameById = new Map<string, string>();
  for (const c of savingConfigs) nameById.set(c.id, c.name);
  for (const c of loanConfigs) nameById.set(c.id, c.name);

  return mappings.map((m) => ({
    id: m.id,
    tenantId: m.tenantId,
    sourceType: m.sourceType,
    sourceId: m.sourceId,
    sourceName: m.sourceId ? (nameById.get(m.sourceId) ?? null) : null,
    transactionKind: m.transactionKind,
    debitAccountId: m.debitAccountId,
    debitAccountName: m.debitAccount.name,
    creditAccountId: m.creditAccountId,
    creditAccountName: m.creditAccount.name,
    createdAt: m.createdAt
  }));
}

/**
 * Create-or-update: the unique key is (tenantId, sourceType, sourceId,
 * transactionKind), and re-submitting the same key is a normal "change this
 * mapping" edit — not a duplicate to reject.
 */
export async function upsertAccountMapping(tenantId: string, data: UpsertAccountMappingInput) {
  const [debitAccount, creditAccount] = await Promise.all([
    db.account.findFirst({ where: { id: data.debitAccountId, tenantId } }),
    db.account.findFirst({ where: { id: data.creditAccountId, tenantId } })
  ]);
  if (!debitAccount) throw notFound("Akun debit tidak ditemukan");
  if (!creditAccount) throw notFound("Akun kredit tidak ditemukan");

  const sourceId = data.sourceId ?? null;
  const existing = await db.accountMapping.findFirst({
    where: { tenantId, sourceType: data.sourceType, sourceId, transactionKind: data.transactionKind }
  });

  if (existing) {
    const updated = await db.accountMapping.update({
      where: { id: existing.id },
      data: { debitAccountId: data.debitAccountId, creditAccountId: data.creditAccountId }
    });
    return { mapping: updated, created: false };
  }

  const created = await db.accountMapping.create({
    data: {
      tenantId,
      sourceType: data.sourceType,
      sourceId,
      transactionKind: data.transactionKind,
      debitAccountId: data.debitAccountId,
      creditAccountId: data.creditAccountId
    }
  });
  return { mapping: created, created: true };
}

export async function deleteAccountMapping(tenantId: string, id: string): Promise<void> {
  const mapping = await db.accountMapping.findFirst({ where: { id, tenantId } });
  if (!mapping) throw notFound("Pemetaan akun tidak ditemukan");
  await db.accountMapping.delete({ where: { id } });
}

// ── SHU Distribution ─────────────────────────────────────────────────────────
// Feeds the "Pembagian SHU" regulatory report (modules/reports) — a tenant
// with no row here just gets an unconfigured notice on that report, not an error.

export async function getShuDistributionConfig(tenantId: string) {
  return db.shuDistributionConfig.findUnique({ where: { tenantId } });
}

export async function upsertShuDistributionConfig(tenantId: string, data: UpsertShuDistributionConfigInput) {
  return db.shuDistributionConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data
  });
}

// ── Whitelabel ───────────────────────────────────────────────────────────────
// Read is never gated — a tenant that loses the entitlement (e.g. downgraded
// package) still sees its frozen values; only writes require requireWhitelabelEntitlement.

export async function getWhitelabelConfig(tenantId: string) {
  return db.whitelabelConfig.findUnique({ where: { tenantId } });
}

export async function upsertWhitelabelConfig(tenantId: string, data: UpsertWhitelabelConfigInput) {
  if (data.customDomain) {
    const duplicate = await db.whitelabelConfig.findFirst({
      where: { customDomain: data.customDomain, NOT: { tenantId } }
    });
    if (duplicate) throw conflict(`Domain ${data.customDomain} sudah digunakan koperasi lain`);
  }

  return db.whitelabelConfig.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    // A newly submitted customDomain always restarts verification at PENDING;
    // leaving it out of the payload (re-saving colors, say) leaves domainStatus untouched.
    update: { ...data, ...(data.customDomain !== undefined ? { domainStatus: "PENDING" } : {}) }
  });
}

// ── Modal Disetor ────────────────────────────────────────────────────────────
// Permenkop UKM No. 2/2024 Pasal 12 mandatory-audit threshold (Rp5M) compliance
// field — a general tenant field, independent of the "accounting" entitlement.

function serializeModalDisetor(tenant: { modalDisetor: Prisma.Decimal | null; auditThresholdNotifiedAt: Date | null }) {
  return {
    modalDisetor: tenant.modalDisetor?.toString() ?? null,
    auditThresholdNotifiedAt: tenant.auditThresholdNotifiedAt
  };
}

export async function getModalDisetor(tenantId: string) {
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { modalDisetor: true, auditThresholdNotifiedAt: true }
  });
  return serializeModalDisetor(tenant);
}

export async function updateModalDisetor(tenantId: string, data: UpdateModalDisetorInput) {
  if (data.modalDisetor !== null && data.modalDisetor < 0) {
    throw validationError("Modal disetor tidak boleh negatif");
  }

  const tenant = await db.tenant.update({
    where: { id: tenantId },
    data: { modalDisetor: data.modalDisetor },
    select: { modalDisetor: true, auditThresholdNotifiedAt: true }
  });
  return serializeModalDisetor(tenant);
}
