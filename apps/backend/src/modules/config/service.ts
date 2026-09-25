import { Prisma } from "@prisma/client";
import type { RepostUnpostedResult, UnpostedJournalSummary } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { isRepostableSourceType, repostUnpostedEntries } from "../../lib/journal.js";
import { isModalDisetorAuditRequired, MODAL_DISETOR_AUDIT_THRESHOLD_RP } from "../../lib/regulatory-config.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { COA_TEMPLATE, SYSTEM_MAPPING_TEMPLATE, type AccountSeed } from "../../lib/coaTemplate.js";
import type {
  CreateAccountInput,
  CreateRoleInput,
  CreateUnitInput,
  UpdateAccountInput,
  UpdateModalDisetorInput,
  UpdateRoleInput,
  UpdateSelfRegistrationInput,
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

  return db.cooperativeUnit.update({ where: { id, tenantId }, data });
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
    where: { id, tenantId },
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

  const usersCount = await db.user.count({ where: { tenantId, roleId: id } });
  if (usersCount > 0) {
    throw conflict("Role masih digunakan oleh pengguna aktif — pindahkan pengguna ke role lain terlebih dahulu");
  }

  await db.role.delete({ where: { id, tenantId } });
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
      db.account.count({ where: { tenantId, parentId: id } }),
      db.accountMapping.count({ where: { tenantId, OR: [{ debitAccountId: id }, { creditAccountId: id }] } }),
      db.journalLine.count({ where: { tenantId, accountId: id } })
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
    where: { id, tenantId },
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

export interface GenerateStandardCoaResult {
  accountsCreated: number;
  accountsSkipped: number;
  mappingsCreated: number;
  mappingsSkipped: number;
}

/**
 * Creates any COA_TEMPLATE account the tenant doesn't already have (matched by
 * `code`), then wires default AccountMappings for every existing SavingConfig
 * (Pokok/Wajib -> Ekuitas, Sukarela -> Kewajiban, both vs. Kas — same pairing
 * as prisma/seed.ts#seedAccounting) and LoanConfig (Disbursement/Principal
 * vs. Piutang, Interest/Penalty vs. Pendapatan, all vs. Kas). Additive and
 * idempotent: existing accounts/mappings are left untouched and simply
 * counted as skipped, so this is safe to call more than once — including
 * after a new saving/loan config is added later, to pick up just its mapping.
 *
 * A tenant with an active KONSUMEN unit additionally gets the Toko accounts
 * (Piutang Anggota, Persediaan, Penjualan, HPP) and the four tenant-wide
 * SYSTEM/SALE_* mappings postPosSale() needs, so a POS sale reaches Neraca and
 * Laba Rugi instead of posting as UNPOSTED_MISSING_MAPPING. Re-running after a
 * Toko unit is added later picks these up the same way.
 */
export async function generateStandardCoa(tenantId: string): Promise<GenerateStandardCoaResult> {
  return db.$transaction(async (tx: TxClient) => {
    const idByCode = new Map((await tx.account.findMany({ where: { tenantId } })).map((a) => [a.code, a.id]));

    let accountsCreated = 0;
    let accountsSkipped = 0;

    async function createTemplateAccount(acc: AccountSeed): Promise<string> {
      const parentCode = acc.parentKey ? COA_TEMPLATE.find((t) => t.key === acc.parentKey)?.code : undefined;
      const parentId = parentCode ? idByCode.get(parentCode) : undefined;
      const created = await tx.account.create({
        data: {
          tenantId,
          code: acc.code,
          name: acc.name,
          category: acc.category,
          normalBalance: acc.normalBalance,
          isHeader: acc.isHeader ?? false,
          isCashEquivalent: acc.isCashEquivalent ?? false,
          isDefault: true,
          isActive: true,
          ...(parentId ? { parentId } : {})
        }
      });
      idByCode.set(acc.code, created.id);
      return created.id;
    }

    for (const acc of COA_TEMPLATE) {
      // Unit-specific (Toko) accounts are handled below, only when the tenant has such a unit.
      if (acc.unitType) continue;
      if (idByCode.has(acc.code)) {
        accountsSkipped += 1;
        continue;
      }
      await createTemplateAccount(acc);
      accountsCreated += 1;
    }

    const accountIdFor = (key: string): string => {
      const code = COA_TEMPLATE.find((t) => t.key === key)?.code;
      const id = code && idByCode.get(code);
      if (!id) throw new Error(`Standard COA template is missing required account "${key}"`);
      return id;
    };

    const kas = accountIdFor("kas");
    const piutang = accountIdFor("piutang_pinjaman");
    const pendapatanBunga = accountIdFor("pendapatan_bunga");
    const pendapatanLain = accountIdFor("pendapatan_lain");
    const equityOrLiabilityBySavingType: Record<string, string> = {
      POKOK: accountIdFor("simpanan_pokok"),
      WAJIB: accountIdFor("simpanan_wajib"),
      SUKARELA: accountIdFor("simpanan_sukarela")
    };

    const [savingConfigs, loanConfigs] = await Promise.all([
      tx.savingConfig.findMany({ where: { tenantId }, select: { id: true, type: true } }),
      tx.loanConfig.findMany({ where: { tenantId }, select: { id: true } })
    ]);

    let mappingsCreated = 0;
    let mappingsSkipped = 0;

    async function ensureMapping(
      sourceType: "SAVING_CONFIG" | "LOAN_CONFIG",
      sourceId: string,
      transactionKind: "DEPOSIT" | "WITHDRAWAL" | "DISBURSEMENT" | "PAYMENT_PRINCIPAL" | "PAYMENT_INTEREST" | "PAYMENT_PENALTY",
      debitAccountId: string,
      creditAccountId: string
    ) {
      const existing = await tx.accountMapping.findFirst({ where: { tenantId, sourceType, sourceId, transactionKind } });
      if (existing) {
        mappingsSkipped += 1;
        return;
      }
      await tx.accountMapping.create({ data: { tenantId, sourceType, sourceId, transactionKind, debitAccountId, creditAccountId } });
      mappingsCreated += 1;
    }

    for (const config of savingConfigs) {
      const equityOrLiability = equityOrLiabilityBySavingType[config.type];
      if (!equityOrLiability) continue;
      await ensureMapping("SAVING_CONFIG", config.id, "DEPOSIT", kas, equityOrLiability);
      await ensureMapping("SAVING_CONFIG", config.id, "WITHDRAWAL", equityOrLiability, kas);
    }

    for (const config of loanConfigs) {
      await ensureMapping("LOAN_CONFIG", config.id, "DISBURSEMENT", piutang, kas);
      await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_PRINCIPAL", kas, piutang);
      await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_INTEREST", kas, pendapatanBunga);
      await ensureMapping("LOAN_CONFIG", config.id, "PAYMENT_PENALTY", kas, pendapatanLain);
    }

    // Toko: only for a tenant that has an active KONSUMEN unit. Lazy per
    // mapping — a tenant that already wired a SYSTEM/SALE_* mapping by hand (to
    // its own accounts) must not get a second, unused set of Toko accounts, so
    // accounts are only created for a mapping that doesn't exist yet.
    const hasKonsumenUnit = (await tx.cooperativeUnit.count({ where: { tenantId, type: "KONSUMEN", isActive: true } })) > 0;
    if (hasKonsumenUnit) {
      const tokoAccountIds = new Map<string, string>();
      const resolveAccount = async (key: string): Promise<string> => {
        const seed = COA_TEMPLATE.find((t) => t.key === key);
        if (!seed?.unitType) return accountIdFor(key);

        const known = tokoAccountIds.get(key);
        if (known) return known;
        let id = idByCode.get(seed.code);
        if (id) {
          accountsSkipped += 1;
        } else {
          id = await createTemplateAccount(seed);
          accountsCreated += 1;
        }
        tokoAccountIds.set(key, id);
        return id;
      };

      for (const template of SYSTEM_MAPPING_TEMPLATE) {
        const existing = await tx.accountMapping.findFirst({
          where: { tenantId, sourceType: "SYSTEM", sourceId: null, transactionKind: template.transactionKind }
        });
        if (existing) {
          mappingsSkipped += 1;
          continue;
        }
        const debitAccountId = await resolveAccount(template.debitKey);
        const creditAccountId = await resolveAccount(template.creditKey);
        await tx.accountMapping.create({
          data: {
            tenantId,
            sourceType: "SYSTEM",
            sourceId: null,
            transactionKind: template.transactionKind,
            debitAccountId,
            creditAccountId
          }
        });
        mappingsCreated += 1;
      }
    }

    return { accountsCreated, accountsSkipped, mappingsCreated, mappingsSkipped };
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
      where: { id: existing.id, tenantId },
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
  await db.accountMapping.delete({ where: { id, tenantId } });
}

// ── Unposted journal entries ─────────────────────────────────────────────────
// A transaction made before its mapping existed is stored UNPOSTED_MISSING_MAPPING
// and stays out of every report until reposted. Reposting rewrites what past
// periods' reports show, so it's an explicit action, never a side effect of
// saving a mapping.

export async function getUnpostedJournalSummary(tenantId: string): Promise<UnpostedJournalSummary> {
  const groups = await db.journalEntry.groupBy({
    by: ["sourceType"],
    where: { tenantId, status: "UNPOSTED_MISSING_MAPPING" },
    _count: { _all: true }
  });

  const items = groups
    .map((g) => ({ sourceType: g.sourceType, count: g._count._all, repostable: isRepostableSourceType(g.sourceType) }))
    .sort((a, b) => a.sourceType.localeCompare(b.sourceType));
  const repostableCount = items.filter((i) => i.repostable).reduce((sum, i) => sum + i.count, 0);
  return { items, repostableCount };
}

export async function repostUnpostedJournalEntries(tenantId: string): Promise<RepostUnpostedResult> {
  // A tenant can have thousands of unposted sales; the batch itself is a
  // handful of queries, but give the interactive transaction headroom anyway.
  return db.$transaction((tx) => repostUnpostedEntries(tx, tenantId), { timeout: 60_000 });
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
    // Global uniqueness check by design: a custom domain must not collide
    // with any *other* tenant's, so this one query legitimately spans all
    // tenants — see lib/tenant-scope.ts.
    const duplicate = await withoutTenantScope(() =>
      db.whitelabelConfig.findFirst({
        where: { customDomain: data.customDomain, NOT: { tenantId } }
      })
    );
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
// Permenkop UKM No. 2/2024 Pasal 12 mandatory-audit threshold (Rp5 miliar)
// compliance field — a general tenant field, independent of the "accounting"
// entitlement. The daily reminder lives in ./audit-threshold.ts.

function serializeModalDisetor(tenant: { modalDisetor: Prisma.Decimal | null; auditThresholdNotifiedAt: Date | null }) {
  return {
    modalDisetor: tenant.modalDisetor?.toString() ?? null,
    auditThreshold: MODAL_DISETOR_AUDIT_THRESHOLD_RP.toString(),
    auditRequired: isModalDisetorAuditRequired(tenant.modalDisetor),
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
  const modalDisetor = data.modalDisetor === null ? null : new Prisma.Decimal(data.modalDisetor);

  const tenant = await db.tenant.update({
    where: { id: tenantId },
    data: {
      modalDisetor,
      // Dropping below the threshold re-arms the reminder, so a later
      // re-crossing in the same year notifies again instead of staying silent.
      ...(isModalDisetorAuditRequired(modalDisetor) ? {} : { auditThresholdNotifiedAt: null })
    },
    select: { modalDisetor: true, auditThresholdNotifiedAt: true }
  });
  return serializeModalDisetor(tenant);
}

// ── Self Registration ────────────────────────────────────────────────────────
// Gates the public QR self-registration form (modules/members/public-registration.*).

export async function getSelfRegistrationConfig(tenantId: string) {
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { selfRegistrationEnabled: true }
  });
  return tenant;
}

export async function updateSelfRegistrationConfig(tenantId: string, data: UpdateSelfRegistrationInput) {
  return db.tenant.update({
    where: { id: tenantId },
    data: { selfRegistrationEnabled: data.selfRegistrationEnabled },
    select: { selfRegistrationEnabled: true }
  });
}
