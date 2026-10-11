import { Prisma } from "@prisma/client";
import { endOfDay } from "date-fns";
import { db } from "../../lib/db.js";
import { notFound, validationError } from "../../lib/errors.js";
import { postManualExpense } from "../../lib/journal.js";
import type { CreateExpenseInput, ListExpensesQueryInput } from "./schema.js";

const EXPENSE_INCLUDE = { lines: { include: { account: true } }, unit: true } as const;

type ExpenseEntryRow = Prisma.JournalEntryGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

function toExpenseEntry(entry: ExpenseEntryRow) {
  const debitLine = entry.lines.find((l) => new Prisma.Decimal(l.debit).gt(0));
  const creditLine = entry.lines.find((l) => new Prisma.Decimal(l.credit).gt(0));
  if (!debitLine || !creditLine) {
    throw new Error(`Beban Umum entry ${entry.id} is missing its debit/credit line`);
  }
  return {
    id: entry.id,
    entryDate: entry.entryDate,
    description: entry.description,
    amount: debitLine.debit,
    debitAccountId: debitLine.accountId,
    debitAccountName: debitLine.account.name,
    creditAccountId: creditLine.accountId,
    creditAccountName: creditLine.account.name,
    unitId: entry.unitId,
    unitName: entry.unit?.name ?? null,
    createdAt: entry.createdAt
  };
}

export async function listExpenseAccounts(tenantId: string) {
  const [debitAccounts, creditAccounts] = await Promise.all([
    db.account.findMany({ where: { tenantId, category: "BEBAN", isActive: true }, orderBy: { code: "asc" } }),
    db.account.findMany({ where: { tenantId, isCashEquivalent: true, isActive: true }, orderBy: { code: "asc" } })
  ]);
  return { debitAccounts, creditAccounts };
}

async function resolveOptionalUnitId(tenantId: string, unitId?: string): Promise<string | null> {
  if (!unitId) return null;
  const unit = await db.cooperativeUnit.findFirst({ where: { id: unitId, tenantId, isActive: true } });
  if (!unit) throw notFound("Unit tidak ditemukan");
  return unit.id;
}

async function getExpenseById(tenantId: string, id: string) {
  const entry = await db.journalEntry.findFirstOrThrow({
    where: { id, tenantId, sourceType: "MANUAL_EXPENSE" },
    include: EXPENSE_INCLUDE
  });
  return toExpenseEntry(entry);
}

export async function createExpense(tenantId: string, input: CreateExpenseInput) {
  const [debitAccount, creditAccount, unitId] = await Promise.all([
    db.account.findFirst({ where: { id: input.debitAccountId, tenantId } }),
    db.account.findFirst({ where: { id: input.creditAccountId, tenantId } }),
    resolveOptionalUnitId(tenantId, input.unitId)
  ]);

  if (!debitAccount) throw notFound("Akun beban tidak ditemukan");
  if (debitAccount.category !== "BEBAN" || !debitAccount.isActive) {
    throw validationError("Akun debit harus akun Beban yang aktif");
  }
  if (!creditAccount) throw notFound("Akun kas/bank tidak ditemukan");
  if (!creditAccount.isCashEquivalent || !creditAccount.isActive) {
    throw validationError("Akun kredit harus akun kas/bank yang aktif");
  }

  const entry = await db.$transaction((tx) =>
    postManualExpense(tx, {
      tenantId,
      unitId,
      debitAccountId: debitAccount.id,
      creditAccountId: creditAccount.id,
      amount: input.amount,
      entryDate: input.entryDate,
      description: input.description
    })
  );

  return getExpenseById(tenantId, entry.id);
}

export async function listExpenses(tenantId: string, query: ListExpensesQueryInput) {
  const { page, limit, unitId, from, to } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.JournalEntryWhereInput = {
    tenantId,
    sourceType: "MANUAL_EXPENSE",
    ...(unitId ? { unitId } : {}),
    ...(from || to ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: endOfDay(to) } : {}) } } : {})
  };

  const [items, total] = await Promise.all([
    db.journalEntry.findMany({ where, skip, take: limit, include: EXPENSE_INCLUDE, orderBy: { entryDate: "desc" } }),
    db.journalEntry.count({ where })
  ]);

  return { items: items.map(toExpenseEntry), meta: { page, limit, total } };
}

export async function deleteExpense(tenantId: string, id: string): Promise<void> {
  const entry = await db.journalEntry.findFirst({ where: { id, tenantId, sourceType: "MANUAL_EXPENSE" } });
  if (!entry) throw notFound("Beban tidak ditemukan");
  await db.journalEntry.delete({ where: { id: entry.id, tenantId } });
}
