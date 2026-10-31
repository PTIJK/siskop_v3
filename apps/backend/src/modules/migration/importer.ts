import { Prisma } from "@prisma/client";
import type { MigrationOpeningLine } from "@siskop/types";
import type { TxClient } from "../../lib/db.js";
import { buildSchedule } from "../../lib/installment-schedule.js";
import { createJournalEntry, postLoanDisbursement, postSavingTransaction } from "../../lib/journal.js";
import { loadOperatingCalendar, parseDateKey } from "../../lib/operating-calendar.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import { recordAudit } from "../audit-log/service.js";
import { generateStandardCoaInTx } from "../config/service.js";
import { provisionTenantInTx } from "../tenants/provision.js";
import { openingLines } from "./opening-balance.js";
import type { ParsedData } from "./rows.js";
import { accountIndex, targetNet } from "./validate.js";

export interface MigrationContext {
  /** User fields for the first admin (id, email, passwordHash, ...). Preview passes a local stub. */
  identity: { id: string; email: string; passwordHash: string | null; firebaseUid: string | null; authProvider: string | null };
  requestId: string;
  /** The platform admin running the migration; recorded on the audit row. */
  actorUserId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ImportOutcome {
  tenantId: string;
  slug: string;
  counts: { sheet: string; rows: number }[];
  openingEntryNo: number | null;
  opening: MigrationOpeningLine[];
}

const chunks = <T>(xs: T[], n = 1000): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return out;
}

export async function runMigration(tx: TxClient, data: ParsedData, ctx: MigrationContext): Promise<ImportOutcome> {
  const k = data.koperasi;
  const cutoff = parseDateKey(k.cutoffDate);
  const slugUpper = k.slug.toUpperCase();

  // 1. Tenant, units, roles, standard COA.
  const { tenant, roles } = await provisionTenantInTx(tx, {
    name: k.name,
    slug: k.slug,
    registrationNo: k.registrationNo,
    address: k.address,
    type: k.type,
    cooperativeType: k.cooperativeType,
    firstUnit: { type: data.units[0]!.type, name: data.units[0]!.name },
    additionalUnits: data.units.slice(1).map((u) => ({ type: u.type, name: u.name }))
  });
  const tenantId = tenant.id;
  if (k.modalDisetor) await tx.tenant.update({ where: { id: tenantId }, data: { modalDisetor: k.modalDisetor } });

  // createMany stamps every unit with the same now(); getDefaultUnitId orders by createdAt, so stagger them
  // in sheet order to make the first sheet-2 unit the default.
  const unitRows = await tx.cooperativeUnit.findMany({ where: { tenantId } });
  const unitIds = new Map<string, string>();
  const base = Date.now();
  for (const [i, u] of data.units.entries()) {
    const row = unitRows.find((r) => r.name === u.name && r.type === u.type)!;
    await tx.cooperativeUnit.update({ where: { id: row.id, tenantId }, data: { createdAt: new Date(base + i) } });
    unitIds.set(u.unitCode, row.id);
  }
  const defaultUnitId = unitIds.get(data.units[0]!.unitCode)!;
  const unitOf = (code?: string) => (code ? unitIds.get(code)! : defaultUnitId);

  // 2. First admin.
  const superAdmin = roles.find((r) => r.name === "Super Admin")!;
  const admin = await tx.user.create({ data: { tenantId, roleId: superAdmin.id, name: k.adminName, ...ctx.identity } });

  // 3. Extra accounts, then products, then mappings (mappings need both).
  const byCode = new Map((await tx.account.findMany({ where: { tenantId } })).map((a) => [a.code, a.id]));
  for (const a of data.extraAccounts) {
    const created = await tx.account.create({
      data: {
        tenantId,
        code: a.code,
        name: a.name,
        category: a.category,
        normalBalance: a.normalBalance,
        isCashEquivalent: a.isCashEquivalent,
        parentId: a.parentCode ? byCode.get(a.parentCode) : undefined
      }
    });
    byCode.set(a.code, created.id);
  }
  const savingConfigIds = new Map<string, string>();
  for (const p of data.savingProducts) {
    const c = await tx.savingConfig.create({
      data: { tenantId, name: p.name, type: p.type, rateType: p.rateType, rate: p.rate, periodUnit: p.periodUnit, isDefault: false, isActive: true }
    });
    savingConfigIds.set(p.code, c.id);
  }
  const loanConfigIds = new Map<string, string>();
  for (const p of data.loanProducts) {
    const c = await tx.loanConfig.create({
      data: {
        tenantId,
        name: p.name,
        type: p.type,
        rateType: p.rateType,
        rate: p.rate,
        maxTermMonths: p.maxTermMonths,
        installmentFrequency: p.installmentFrequency,
        maxInstallments: p.maxInstallments,
        isActive: true
      }
    });
    loanConfigIds.set(p.code, c.id);
  }
  await generateStandardCoaInTx(tx, tenantId);
  // generateStandardCoa may add accounts (unit-gated); refresh the code -> id map.
  for (const a of await tx.account.findMany({ where: { tenantId }, select: { id: true, code: true } })) byCode.set(a.code, a.id);

  // 4. Members. memberId is numbered in memory: generateMemberId counts rows in the DB per call.
  const yyyymm = `${cutoff.getUTCFullYear()}${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}`;
  const accountNumbers = await uniqueAccountNumbers(tx, data.members.length);
  const memberIds = new Map<string, string>();
  for (const [ci, chunk] of chunks(data.members).entries()) {
    const created = await tx.member.createManyAndReturn({
      data: chunk.map((m, i) => ({
        tenantId,
        memberId: `KOP-${slugUpper}-${yyyymm}-${String(ci * 1000 + i + 1).padStart(4, "0")}`,
        accountNumber: accountNumbers[ci * 1000 + i]!,
        fullName: m.fullName,
        nik: m.nik,
        address: m.address,
        birthPlace: m.birthPlace,
        birthDate: new Date(m.birthDate),
        occupation: m.occupation,
        isActive: m.isActive,
        isPengurus: m.isPengurus,
        isPengawas: m.isPengawas,
        commodity: m.commodity ?? null
      })),
      select: { id: true, nik: true }
    });
    for (const c of created) memberIds.set(c.nik, c.id);
    await tx.unitMembership.createMany({ data: chunk.map((m) => ({ memberId: memberIds.get(m.nik)!, unitId: unitOf(m.unitCode) })) });
  }

  // 5. Savings: balance, one DEPOSIT, one journal entry each (same path createSaving uses).
  for (const s of data.savings) {
    const unitId = unitOf(s.unitCode);
    const saving = await tx.saving.create({
      data: { tenantId, unitId, memberId: memberIds.get(s.nik)!, savingConfigId: savingConfigIds.get(s.productCode)!, balance: s.balance, isActive: true }
    });
    if (s.balance.gt(0)) {
      const txn = await tx.savingTransaction.create({
        data: { savingId: saving.id, tenantId, type: "DEPOSIT", amount: s.balance, note: "Saldo awal migrasi", createdBy: admin.id, createdAt: cutoff }
      });
      await postSavingTransaction(tx, {
        tenantId,
        unitId,
        savingTransactionId: txn.id,
        savingConfigId: saving.savingConfigId,
        kind: "DEPOSIT",
        amount: s.balance,
        entryDate: cutoff,
        description: "Saldo awal simpanan (migrasi)"
      });
    }
  }

  // 6. Loans.
  const calendar = await loadOperatingCalendar(tx, tenantId);
  const productRate = new Map(data.loanProducts.map((p) => [p.code, p.rate]));
  const scheduleByRef = groupBy(data.schedule, (s) => s.loanRef);
  for (const l of data.loans) {
    const unitId = unitOf(l.unitCode);
    const disbursedAt = parseDateKey(l.disbursedAt);
    const given = scheduleByRef.get(l.loanRef);
    const installments = given
      ? given.map((g) => ({
          seq: g.seq,
          dueDate: parseDateKey(g.dueDate),
          principalDue: g.principalDue,
          interestDue: g.interestDue,
          principalPaid: g.principalPaid,
          interestPaid: g.interestPaid,
          paidOffAt: g.paidOffAt ? parseDateKey(g.paidOffAt) : null
        }))
      : l.status === "COMPLETED"
        ? []
        : buildSchedule({
            principal: l.remainingPrincipal,
            totalAmount: l.remainingAmount,
            frequency: "MONTHLY",
            count: l.termMonths,
            disbursedAt: cutoff,
            calendar
          }).map((s) => ({ ...s, principalPaid: new Prisma.Decimal(0), interestPaid: new Prisma.Decimal(0), paidOffAt: null as Date | null }));
    const first = installments[0];
    const last = installments[installments.length - 1];
    const firstAmount = first ? first.principalDue.add(first.interestDue) : null;
    const configRate = productRate.get(l.productCode)!;
    const loan = await tx.loan.create({
      data: {
        tenantId,
        unitId,
        memberId: memberIds.get(l.nik)!,
        loanConfigId: loanConfigIds.get(l.productCode)!,
        principalAmount: l.principalAmount,
        totalAmount: l.totalAmount,
        termMonths: l.termMonths,
        monthlyPayment: l.installmentAmount ?? firstAmount ?? new Prisma.Decimal(0),
        remainingAmount: l.remainingAmount,
        status: l.status,
        kolCategory: l.kolCategory,
        daysOverdue: l.daysOverdue,
        disbursedAt,
        installmentFrequency: l.installmentFrequency,
        installmentCount: l.installmentFrequency === "MONTHLY" ? null : (l.installmentCount ?? null),
        installmentAmount: l.installmentAmount ?? firstAmount,
        rate: l.rate ?? configRate,
        rateNote: l.rate !== undefined && l.rate !== configRate ? "Migrasi: tarif sistem lama" : null,
        notes: l.notes,
        maturityDate: last?.dueDate ?? null
      }
    });
    if (installments.length > 0) {
      await tx.loanInstallment.createMany({
        data: installments.map((s) => {
          const paid = s.principalPaid.add(s.interestPaid);
          const due = s.principalDue.add(s.interestDue);
          return {
            tenantId,
            loanId: loan.id,
            seq: s.seq,
            dueDate: s.dueDate,
            principalDue: s.principalDue,
            interestDue: s.interestDue,
            principalPaid: s.principalPaid,
            interestPaid: s.interestPaid,
            paidOffAt: s.paidOffAt,
            status: paid.gte(due) ? ("PAID" as const) : paid.gt(0) ? ("PARTIAL" as const) : ("UNPAID" as const)
          };
        })
      });
    }
    if (l.status !== "COMPLETED" && l.remainingPrincipal.gt(0)) {
      await postLoanDisbursement(tx, {
        tenantId,
        unitId,
        loanId: loan.id,
        loanConfigId: loan.loanConfigId,
        amount: l.remainingPrincipal,
        entryDate: cutoff,
        description: "Saldo awal pinjaman (migrasi)"
      });
    }
  }

  // 7. Opening entry = target trial balance minus what steps 5-6 already journaled.
  const index = accountIndex(data);
  const target = new Map<string, Prisma.Decimal>();
  for (const [code, net] of targetNet(data, index)) target.set(byCode.get(code)!, net);
  const auto = new Map<string, Prisma.Decimal>();
  const posted = await tx.journalLine.findMany({ where: { tenantId }, select: { accountId: true, debit: true, credit: true } });
  for (const p of posted) auto.set(p.accountId, (auto.get(p.accountId) ?? new Prisma.Decimal(0)).add(p.debit).sub(p.credit));
  const lines = openingLines(target, auto);
  let openingEntryNo: number | null = null;
  if (lines.length > 0) {
    const entry = await createJournalEntry(tx, {
      tenantId,
      unitId: null,
      entryDate: cutoff,
      sourceType: "MANUAL",
      sourceId: null,
      description: "Saldo Awal Migrasi",
      createdById: admin.id,
      lines: lines.map((l) => ({ accountId: l.key, debit: l.debit, credit: l.credit }))
    });
    openingEntryNo = entry.entryNo;
  }

  await recordAudit(
    tx,
    {
      action: "tenant.migrate",
      entityType: "Tenant",
      entityId: tenantId,
      after: {
        mode: data.mode,
        cutoffDate: k.cutoffDate,
        members: data.members.length,
        savings: data.savings.length,
        loans: data.loans.length,
        openingEntryNo
      }
    },
    { tenantId, actorUserId: ctx.actorUserId, requestId: ctx.requestId, ip: ctx.ip, userAgent: ctx.userAgent }
  );

  const codeById = new Map([...byCode].map(([c, id]) => [id, c]));
  const accounts = await tx.account.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return {
    tenantId,
    slug: tenant.slug,
    counts: [
      { sheet: "Anggota", rows: data.members.length },
      { sheet: "Rekening simpanan", rows: data.savings.length },
      { sheet: "Pinjaman", rows: data.loans.length },
      { sheet: "Baris jurnal saldo awal", rows: lines.length }
    ],
    openingEntryNo,
    opening: lines.map((l) => ({
      accountCode: codeById.get(l.key)!,
      accountName: names.get(l.key) ?? "",
      debit: l.debit.toString(),
      credit: l.credit.toString()
    }))
  };
}

/** ACC-{10 digits}, unique across all tenants; the check must see every tenant's members. */
async function uniqueAccountNumbers(tx: TxClient, n: number): Promise<string[]> {
  const out = new Set<string>();
  while (out.size < n) {
    const batch = new Set<string>();
    while (out.size + batch.size < n) batch.add(`ACC-${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`);
    const taken = await withoutTenantScope(() => tx.member.findMany({ where: { accountNumber: { in: [...batch] } }, select: { accountNumber: true } }));
    const takenSet = new Set(taken.map((t) => t.accountNumber));
    for (const a of batch) if (!takenSet.has(a) && !out.has(a)) out.add(a);
  }
  return [...out];
}
