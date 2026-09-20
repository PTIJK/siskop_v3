import { ErrorCode } from "@siskop/types";
import { Prisma, type JournalSourceType } from "@prisma/client";
import { AppError, conflict } from "./errors.js";
import type { TxClient } from "./db.js";

interface JournalLineInput {
  accountId: string;
  debit?: number | Prisma.Decimal;
  credit?: number | Prisma.Decimal;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type MappingSource = "SAVING_CONFIG" | "LOAN_CONFIG" | "SYSTEM";

type MappingKind =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "SAVING_INTEREST"
  | "DISBURSEMENT"
  | "PAYMENT_PRINCIPAL"
  | "PAYMENT_INTEREST"
  | "PAYMENT_PENALTY"
  | "SALE_REVENUE"
  | "SALE_COGS"
  | "SALE_RECEIVABLE"
  | "MEMBER_CREDIT_REPAYMENT"
  | "STOCK_PURCHASE";

/**
 * Resolves the debit/credit accounts for one transaction kind and returns a
 * balanced debit+credit line pair, or [] if no mapping exists yet — a missing
 * mapping must never block the source transaction, it's just left out of this
 * entry (see createJournalEntry's UNPOSTED_MISSING_MAPPING status below).
 */
async function buildComponentLines(
  tx: TxClient,
  tenantId: string,
  sourceType: MappingSource,
  sourceId: string | null,
  transactionKind: MappingKind,
  amount: number | Prisma.Decimal
): Promise<JournalLineInput[]> {
  if (new Prisma.Decimal(amount).lte(0)) return [];

  const mapping = await tx.accountMapping.findFirst({
    where: { tenantId, sourceType, sourceId, transactionKind }
  });
  if (!mapping) return [];

  return [
    { accountId: mapping.debitAccountId, debit: amount },
    { accountId: mapping.creditAccountId, credit: amount }
  ];
}

/** Guard rail shared by posting and reposting: every entry must balance to the cent. */
function assertBalanced(lines: JournalLineInput[], label: string): void {
  const totalDebit = lines.reduce((sum, l) => sum.plus(l.debit ?? 0), new Prisma.Decimal(0)).toDecimalPlaces(2);
  const totalCredit = lines.reduce((sum, l) => sum.plus(l.credit ?? 0), new Prisma.Decimal(0)).toDecimalPlaces(2);
  if (!totalDebit.equals(totalCredit)) {
    throw new AppError(
      ErrorCode.JOURNAL_ENTRY_UNBALANCED,
      `Journal entry for ${label} is unbalanced (debit ${totalDebit} != credit ${totalCredit})`
    );
  }
}

/**
 * Creates a JournalEntry + its JournalLines. Every component contributed by
 * buildComponentLines() is already a balanced debit/credit pair, so the total
 * is balanced as long as no line was built independently — the sum check here
 * is a guard rail, not a correction mechanism. An entry with zero lines
 * (nothing could be mapped) is stored as UNPOSTED_MISSING_MAPPING. It stays out
 * of every report until repostUnpostedEntries() (below) rebuilds it — adding a
 * mapping later only affects transactions made *afterwards*, and reposting
 * currently covers POS sales, member-credit repayments and restocks, not savings
 * or loan entries.
 */
async function createJournalEntry(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The unit the source transaction belongs to; null for an entry that belongs to no single unit. */
    unitId: string | null;
    entryDate: Date;
    sourceType:
      | "SAVING_TRANSACTION"
      | "LOAN_PAYMENT"
      | "LOAN_DISBURSEMENT"
      | "POS_SALE"
      | "MEMBER_CREDIT_REPAYMENT"
      | "STOCK_MOVEMENT";
    sourceId: string;
    description: string;
    lines: JournalLineInput[];
  }
): Promise<void> {
  const { tenantId, unitId, entryDate, sourceType, sourceId, description, lines } = params;

  assertBalanced(lines, `${sourceType}:${sourceId}`);

  const entry = await tx.journalEntry.create({
    data: {
      tenantId,
      unitId,
      entryDate,
      sourceType,
      sourceId,
      description,
      status: lines.length > 0 ? "POSTED" : "UNPOSTED_MISSING_MAPPING"
    }
  });

  if (lines.length > 0) {
    await tx.journalLine.createMany({
      data: lines.map((l) => ({
        journalEntryId: entry.id,
        tenantId,
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0
      }))
    });
  }
}

export async function postSavingTransaction(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The Saving's unitId. */
    unitId: string | null;
    savingTransactionId: string;
    savingConfigId: string;
    kind: "DEPOSIT" | "WITHDRAWAL" | "SAVING_INTEREST";
    amount: number | Prisma.Decimal;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  const lines = await buildComponentLines(
    tx,
    params.tenantId,
    "SAVING_CONFIG",
    params.savingConfigId,
    params.kind,
    params.amount
  );
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "SAVING_TRANSACTION",
    sourceId: params.savingTransactionId,
    description: params.description,
    lines
  });
}

export async function postLoanDisbursement(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The Loan's unitId. */
    unitId: string | null;
    loanId: string;
    loanConfigId: string;
    amount: number;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  const lines = await buildComponentLines(
    tx,
    params.tenantId,
    "LOAN_CONFIG",
    params.loanConfigId,
    "DISBURSEMENT",
    params.amount
  );
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "LOAN_DISBURSEMENT",
    sourceId: params.loanId,
    description: params.description,
    lines
  });
}

export async function postLoanPayment(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The paid Loan's unitId. */
    unitId: string | null;
    loanPaymentId: string;
    loanConfigId: string;
    principalAmount: number;
    interestAmount: number;
    penaltyAmount: number;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  const [principalLines, interestLines, penaltyLines] = await Promise.all([
    buildComponentLines(tx, params.tenantId, "LOAN_CONFIG", params.loanConfigId, "PAYMENT_PRINCIPAL", params.principalAmount),
    buildComponentLines(tx, params.tenantId, "LOAN_CONFIG", params.loanConfigId, "PAYMENT_INTEREST", params.interestAmount),
    buildComponentLines(tx, params.tenantId, "LOAN_CONFIG", params.loanConfigId, "PAYMENT_PENALTY", params.penaltyAmount)
  ]);

  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "LOAN_PAYMENT",
    sourceId: params.loanPaymentId,
    description: params.description,
    lines: [...principalLines, ...interestLines, ...penaltyLines]
  });
}

/**
 * No per-installment amortization schedule exists, so a payment's principal/
 * interest split is approximated by applying the loan's overall interest
 * ratio to each payment — a documented approximation, not a precision bug.
 * Ported as-is from the pre-rescaffold system.
 */
export function splitPrincipalAndInterest(
  paymentAmount: number,
  loanPrincipalAmount: number,
  loanTotalAmount: number
): { principal: number; interest: number } {
  const totalInterest = loanTotalAmount - loanPrincipalAmount;
  const interestRatio = loanTotalAmount > 0 ? totalInterest / loanTotalAmount : 0;
  const interest = round2(paymentAmount * interestRatio);
  const principal = round2(paymentAmount - interest);
  return { principal, interest };
}

export type PosPaymentMethod = "CASH" | "TRANSFER" | "MEMBER_CREDIT";

/** Tenant-wide SYSTEM mappings by transaction kind — every Toko posting resolves through these. */
type SystemMappings = Map<string, { debitAccountId: string; creditAccountId: string }>;

/**
 * One query for all of a tenant's SYSTEM mappings (at most 4 rows) instead of
 * one lookup per component: posting a sale reads them once, and a repost of
 * thousands of entries also reads them once.
 */
async function loadSystemMappings(tx: TxClient, tenantId: string): Promise<SystemMappings> {
  const rows = await tx.accountMapping.findMany({ where: { tenantId, sourceType: "SYSTEM", sourceId: null } });
  return new Map(rows.map((r) => [r.transactionKind, { debitAccountId: r.debitAccountId, creditAccountId: r.creditAccountId }]));
}

/**
 * `[]` = nothing to post (zero/negative amount); `null` = an amount that needs
 * posting but has no mapping yet. Telling those apart is what lets a POS sale
 * refuse a half-mapped posting (see posSaleLinesFrom).
 */
function componentLinesFrom(
  mappings: SystemMappings,
  transactionKind: MappingKind,
  amount: number | Prisma.Decimal
): JournalLineInput[] | null {
  if (new Prisma.Decimal(amount).lte(0)) return [];
  const mapping = mappings.get(transactionKind);
  if (!mapping) return null;
  return [
    { accountId: mapping.debitAccountId, debit: amount },
    { accountId: mapping.creditAccountId, credit: amount }
  ];
}

function posSaleLinesFrom(
  mappings: SystemMappings,
  sale: { paymentMethod: PosPaymentMethod; totalPrice: number | Prisma.Decimal; totalCost: number | Prisma.Decimal }
): JournalLineInput[] {
  const revenueKind = sale.paymentMethod === "MEMBER_CREDIT" ? "SALE_RECEIVABLE" : "SALE_REVENUE";
  const revenue = componentLinesFrom(mappings, revenueKind, sale.totalPrice);
  const cogs = componentLinesFrom(mappings, "SALE_COGS", sale.totalCost);
  if (revenue === null || cogs === null) return [];
  return [...revenue, ...cogs];
}

function memberCreditRepaymentLinesFrom(mappings: SystemMappings, amount: number | Prisma.Decimal): JournalLineInput[] {
  return componentLinesFrom(mappings, "MEMBER_CREDIT_REPAYMENT", amount) ?? [];
}

function stockPurchaseLinesFrom(mappings: SystemMappings, amount: number | Prisma.Decimal): JournalLineInput[] {
  return componentLinesFrom(mappings, "STOCK_PURCHASE", amount) ?? [];
}

/**
 * Posts a POS sale's revenue and COGS as one balanced journal entry (up to
 * 4 lines: a Kas-or-Piutang/Penjualan pair plus an HPP/Persediaan pair).
 * Unlike the SAVING_CONFIG/LOAN_CONFIG mappings above (one per config row), a
 * POS sale mapping is tenant-wide: `sourceType: "SYSTEM"` with `sourceId:
 * null` — see `AccountMapping.sourceId` (nullable) and config/service.ts's
 * own `sourceId ?? null` handling for the same SYSTEM scope.
 *
 * The revenue-side pair uses SALE_RECEIVABLE instead of SALE_REVENUE for a
 * MEMBER_CREDIT sale — the coop hasn't received cash, so the debit side must
 * land on a receivable (Piutang Anggota), not Kas. COGS/inventory is
 * unaffected either way: the goods left the shelf regardless of how the
 * customer paid.
 *
 * All-or-nothing: if either the revenue-side or the COGS-side mapping is
 * missing (for an amount that needs one), NOTHING is posted and the entry is
 * stored as UNPOSTED_MISSING_MAPPING. Posting only half would look POSTED
 * while overstating margin and never reducing Persediaan; leaving it unposted
 * keeps it visible to repostUnpostedEntries() once the mapping is completed.
 */
export async function postPosSale(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The POSSale's unitId (the Toko that made the sale). */
    unitId: string | null;
    saleId: string;
    paymentMethod: PosPaymentMethod;
    totalPrice: number | Prisma.Decimal;
    totalCost: number | Prisma.Decimal;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  const mappings = await loadSystemMappings(tx, params.tenantId);
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "POS_SALE",
    sourceId: params.saleId,
    description: params.description,
    lines: posSaleLinesFrom(mappings, params)
  });
}

/**
 * Reverses a member's store-credit receivable as they pay it down: debits
 * Kas, credits Piutang Anggota — the mirror image of postPosSale's
 * SALE_RECEIVABLE line above. Tenant-wide SYSTEM mapping, same shape as
 * every other POS mapping in this file.
 */
export async function postMemberCreditRepayment(
  tx: TxClient,
  params: {
    tenantId: string;
    /**
     * Always null today: MemberCreditRepayment is tenant-wide by design (eligibility and the
     * Piutang account are tenant-level), so the repayment sits in the "unallocated" bucket.
     */
    unitId: string | null;
    repaymentId: string;
    amount: number | Prisma.Decimal;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  const mappings = await loadSystemMappings(tx, params.tenantId);
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "MEMBER_CREDIT_REPAYMENT",
    sourceId: params.repaymentId,
    description: params.description,
    lines: memberCreditRepaymentLinesFrom(mappings, params.amount)
  });
}

/**
 * A Toko restock (StockMovement `IN`): the shelf gains goods worth product cost x quantity and
 * the koperasi pays for them — Dr Persediaan / Cr Kas through the tenant's SYSTEM/STOCK_PURCHASE
 * mapping (an admin can point the credit side at Utang Usaha instead). Without this Persediaan
 * was only ever credited (by HPP) and went negative in Neraca.
 *
 * Nothing is posted for a zero amount: a zero-cost item has nothing to book, and an entry for it
 * would be a placeholder no mapping could ever clear. Valued at the product's current cost —
 * Product.cost has no edit path today, so it is what the goods were bought at; if editing is ever
 * added the movement should store its own cost.
 *
 * `ADJUSTMENT` movements are deliberately not journaled: they *set* the count and the previous
 * quantity isn't stored, so the delta (and its value) can't be recovered.
 */
export async function postStockPurchase(
  tx: TxClient,
  params: {
    tenantId: string;
    /** The StockMovement's unitId (the Toko that was restocked). */
    unitId: string | null;
    movementId: string;
    amount: number | Prisma.Decimal;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  if (new Prisma.Decimal(params.amount).lte(0)) return;

  const mappings = await loadSystemMappings(tx, params.tenantId);
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    unitId: params.unitId,
    entryDate: params.entryDate,
    sourceType: "STOCK_MOVEMENT",
    sourceId: params.movementId,
    description: params.description,
    lines: stockPurchaseLinesFrom(mappings, params.amount)
  });
}

// ── Reposting entries stored as UNPOSTED_MISSING_MAPPING ─────────────────────
// A transaction made before its account mapping existed leaves an entry with no
// lines. Adding the mapping later only affects *new* transactions, so without
// this the old ones stay invisible to Neraca/Laba Rugi forever.

/**
 * Source types repostUnpostedEntries() can rebuild, each from its own source
 * row plus the tenant's current SYSTEM mappings (POS sales, member-credit
 * repayments, restocks). Savings/loan entries are not
 * here yet (their split/config-scoped mappings need their own rebuild logic);
 * the registry shape is what lets them be added without touching the driver.
 */
const REPOSTABLE_SOURCE_TYPES = [
  "POS_SALE",
  "MEMBER_CREDIT_REPAYMENT",
  "STOCK_MOVEMENT"
] as const satisfies readonly JournalSourceType[];

export function isRepostableSourceType(sourceType: string): boolean {
  return (REPOSTABLE_SOURCE_TYPES as readonly string[]).includes(sourceType);
}

export interface RepostResult {
  reposted: number;
  /** Repostable entries whose required mapping still doesn't exist — left untouched. */
  stillUnmapped: number;
}

/**
 * Rebuilds and posts every repostable UNPOSTED_MISSING_MAPPING entry of one
 * tenant that the tenant's *current* mappings can now fully cover. Only
 * UNPOSTED entries are ever touched — a POSTED entry is never re-mapped — and
 * each keeps its original entryDate, so a past period's report changes to
 * include it (which is the point, and why callers expose this as an explicit
 * action rather than running it silently).
 *
 * Batch shape on purpose: one entries query, one mappings query, one bulk read
 * per source table, then a single updateMany + createMany — a tenant can have
 * thousands of unposted sales, and a per-entry loop would blow through
 * Prisma's interactive-transaction timeout.
 *
 * The status flip runs first and must match every id it targets. Two
 * concurrent reposts serialize on the row locks, the loser then sees the rows
 * already POSTED, matches fewer than it expected, and aborts — so an entry can
 * never receive its lines twice.
 */
export async function repostUnpostedEntries(tx: TxClient, tenantId: string): Promise<RepostResult> {
  const entries = await tx.journalEntry.findMany({
    where: { tenantId, status: "UNPOSTED_MISSING_MAPPING", sourceType: { in: [...REPOSTABLE_SOURCE_TYPES] } },
    select: { id: true, sourceType: true, sourceId: true }
  });
  if (entries.length === 0) return { reposted: 0, stillUnmapped: 0 };

  const idsOf = (sourceType: JournalSourceType) =>
    entries.filter((e) => e.sourceType === sourceType && e.sourceId).map((e) => e.sourceId as string);

  const [mappings, sales, repayments, restocks] = await Promise.all([
    loadSystemMappings(tx, tenantId),
    tx.pOSSale.findMany({
      where: { tenantId, id: { in: idsOf("POS_SALE") } },
      select: { id: true, paymentMethod: true, totalPrice: true, totalCost: true }
    }),
    tx.memberCreditRepayment.findMany({
      where: { tenantId, id: { in: idsOf("MEMBER_CREDIT_REPAYMENT") } },
      select: { id: true, amount: true }
    }),
    tx.stockMovement.findMany({
      where: { tenantId, id: { in: idsOf("STOCK_MOVEMENT") }, type: "IN" },
      select: { id: true, quantity: true, product: { select: { cost: true } } }
    })
  ]);
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const repaymentById = new Map(repayments.map((r) => [r.id, r]));
  const restockById = new Map(restocks.map((m) => [m.id, m]));

  const postedEntryIds: string[] = [];
  const lineRows: Prisma.JournalLineCreateManyInput[] = [];
  let stillUnmapped = 0;

  for (const entry of entries) {
    let lines: JournalLineInput[] = [];
    if (entry.sourceType === "POS_SALE") {
      const sale = entry.sourceId ? saleById.get(entry.sourceId) : undefined;
      if (sale) lines = posSaleLinesFrom(mappings, { ...sale, paymentMethod: sale.paymentMethod as PosPaymentMethod });
    } else if (entry.sourceType === "MEMBER_CREDIT_REPAYMENT") {
      const repayment = entry.sourceId ? repaymentById.get(entry.sourceId) : undefined;
      if (repayment) lines = memberCreditRepaymentLinesFrom(mappings, repayment.amount);
    } else if (entry.sourceType === "STOCK_MOVEMENT") {
      const restock = entry.sourceId ? restockById.get(entry.sourceId) : undefined;
      if (restock) lines = stockPurchaseLinesFrom(mappings, restock.product.cost.mul(restock.quantity));
    }

    if (lines.length === 0) {
      stillUnmapped += 1;
      continue;
    }
    assertBalanced(lines, `${entry.sourceType}:${entry.sourceId}`);
    postedEntryIds.push(entry.id);
    for (const l of lines) {
      lineRows.push({ journalEntryId: entry.id, tenantId, accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0 });
    }
  }

  if (postedEntryIds.length > 0) {
    const flipped = await tx.journalEntry.updateMany({
      where: { tenantId, id: { in: postedEntryIds }, status: "UNPOSTED_MISSING_MAPPING" },
      data: { status: "POSTED" }
    });
    if (flipped.count !== postedEntryIds.length) {
      throw conflict("Posting ulang sedang diproses di sesi lain, coba lagi");
    }
    await tx.journalLine.createMany({ data: lineRows });
  }

  return { reposted: postedEntryIds.length, stillUnmapped };
}
