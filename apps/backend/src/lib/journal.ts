import { Prisma } from '@prisma/client';
import { Errors } from './errors';

type TxClient = Prisma.TransactionClient;

interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolves the debit/credit accounts for one transaction kind and returns a
 * balanced debit+credit line pair, or [] if no mapping exists yet (Design Spec
 * 2026-07-22-pelaporan-regulasi §3, Backend: missing mapping must never block
 * the source transaction — it's just left out of this entry).
 */
async function buildComponentLines(
  tx: TxClient,
  tenantId: string,
  sourceType: 'SAVING_CONFIG' | 'LOAN_CONFIG',
  sourceId: string,
  transactionKind: 'DEPOSIT' | 'WITHDRAWAL' | 'DISBURSEMENT' | 'PAYMENT_PRINCIPAL' | 'PAYMENT_INTEREST' | 'PAYMENT_PENALTY',
  amount: number
): Promise<JournalLineInput[]> {
  if (amount <= 0) return [];

  const mapping = await tx.accountMapping.findFirst({
    where: { tenantId, sourceType, sourceId, transactionKind },
  });
  if (!mapping) return [];

  return [
    { accountId: mapping.debitAccountId, debit: amount },
    { accountId: mapping.creditAccountId, credit: amount },
  ];
}

/**
 * Creates a JournalEntry + its JournalLines. Every component contributed by
 * buildComponentLines() is already a balanced debit/credit pair, so the
 * total is balanced as long as no line was built independently — the sum
 * check here is a guard rail, not a correction mechanism (Design Spec §9,
 * JOURNAL_ENTRY_UNBALANCED). An entry with zero lines (nothing could be
 * mapped) is stored as UNPOSTED_MISSING_MAPPING so it can be identified and
 * backfilled once the tenant completes their account mapping.
 */
async function createJournalEntry(
  tx: TxClient,
  params: {
    tenantId: string;
    entryDate: Date;
    sourceType: 'SAVING_TRANSACTION' | 'LOAN_PAYMENT' | 'LOAN_DISBURSEMENT';
    sourceId: string;
    description: string;
    lines: JournalLineInput[];
  }
): Promise<void> {
  const { tenantId, entryDate, sourceType, sourceId, description, lines } = params;

  const totalDebit = round2(lines.reduce((sum, l) => sum + (l.debit ?? 0), 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + (l.credit ?? 0), 0));
  if (totalDebit !== totalCredit) {
    throw Errors.JOURNAL_ENTRY_UNBALANCED(
      `Entri jurnal untuk ${sourceType}:${sourceId} tidak seimbang (debit ${totalDebit} != kredit ${totalCredit})`
    );
  }

  const entry = await tx.journalEntry.create({
    data: {
      tenantId,
      entryDate,
      sourceType,
      sourceId,
      description,
      status: lines.length > 0 ? 'POSTED' : 'UNPOSTED_MISSING_MAPPING',
    },
  });

  if (lines.length > 0) {
    await tx.journalLine.createMany({
      data: lines.map((l) => ({
        journalEntryId: entry.id,
        tenantId,
        accountId: l.accountId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
      })),
    });
  }
}

export async function postSavingTransaction(
  tx: TxClient,
  params: {
    tenantId: string;
    savingTransactionId: string;
    savingConfigId: string;
    kind: 'DEPOSIT' | 'WITHDRAWAL';
    amount: number;
    entryDate: Date;
    description: string;
  }
): Promise<void> {
  const lines = await buildComponentLines(
    tx,
    params.tenantId,
    'SAVING_CONFIG',
    params.savingConfigId,
    params.kind,
    params.amount
  );
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    entryDate: params.entryDate,
    sourceType: 'SAVING_TRANSACTION',
    sourceId: params.savingTransactionId,
    description: params.description,
    lines,
  });
}

export async function postLoanDisbursement(
  tx: TxClient,
  params: {
    tenantId: string;
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
    'LOAN_CONFIG',
    params.loanConfigId,
    'DISBURSEMENT',
    params.amount
  );
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    entryDate: params.entryDate,
    sourceType: 'LOAN_DISBURSEMENT',
    sourceId: params.loanId,
    description: params.description,
    lines,
  });
}

export async function postLoanPayment(
  tx: TxClient,
  params: {
    tenantId: string;
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
    buildComponentLines(tx, params.tenantId, 'LOAN_CONFIG', params.loanConfigId, 'PAYMENT_PRINCIPAL', params.principalAmount),
    buildComponentLines(tx, params.tenantId, 'LOAN_CONFIG', params.loanConfigId, 'PAYMENT_INTEREST', params.interestAmount),
    buildComponentLines(tx, params.tenantId, 'LOAN_CONFIG', params.loanConfigId, 'PAYMENT_PENALTY', params.penaltyAmount),
  ]);

  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    entryDate: params.entryDate,
    sourceType: 'LOAN_PAYMENT',
    sourceId: params.loanPaymentId,
    description: params.description,
    lines: [...principalLines, ...interestLines, ...penaltyLines],
  });
}

/**
 * SISKOP doesn't track a per-installment amortization schedule (loan-calc.ts
 * only computes a flat monthlyPayment/totalInterest at loan creation), so a
 * payment's principal/interest split is approximated by applying the loan's
 * overall interest ratio to each payment — consistent with the flat-margin
 * (syariah) calculation and a reasonable approximation for anuitas loans
 * given no schedule exists to split exactly. Documented assumption, not a
 * precision bug: revisit if/when an amortization schedule is built.
 */
export function splitPrincipalAndInterest(
  paymentAmount: number,
  loanPrincipalAmount: number,
  loanTotalAmount: number
): { principal: number; interest: number } {
  const totalInterest = Number(loanTotalAmount) - Number(loanPrincipalAmount);
  const interestRatio = Number(loanTotalAmount) > 0 ? totalInterest / Number(loanTotalAmount) : 0;
  const interest = round2(paymentAmount * interestRatio);
  const principal = round2(paymentAmount - interest);
  return { principal, interest };
}
