import { Prisma } from "@prisma/client";
import type { TxClient } from "./db.js";
import { splitLoanPayment } from "./journal.js";

export interface AllocationResult {
  principal: Prisma.Decimal;
  interest: Prisma.Decimal;
  allocations: { installmentId: string; seq: number; principal: string; interest: string }[];
}

/**
 * Applies a payment to the oldest UNPAID/PARTIAL installment(s) first,
 * interest before principal within each one (D3/F2 plan), until the amount
 * is exhausted. A loan with no schedule yet (created before F2's migration,
 * not backfilled — see modules/loans/backfill.ts) falls back to the old
 * whole-loan flat-ratio split, since it has no installments to allocate
 * against. Shared by recordLoanPayment (a real payment) and the backfill
 * script (replaying historical LoanPayment rows against a schedule built
 * after the fact), so both allocate exactly the same way.
 */
export async function allocatePayment(
  tx: TxClient,
  params: {
    tenantId: string;
    loan: {
      installments: {
        id: string;
        seq: number;
        principalDue: Prisma.Decimal;
        interestDue: Prisma.Decimal;
        principalPaid: Prisma.Decimal;
        interestPaid: Prisma.Decimal;
      }[];
      principalAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
    };
    paymentId: string;
    amount: Prisma.Decimal;
    paidAt: Date;
  }
): Promise<AllocationResult> {
  if (params.loan.installments.length === 0) {
    const split = splitLoanPayment(params.amount, params.loan.principalAmount, params.loan.totalAmount);
    return { principal: split.principal, interest: split.interest, allocations: [] };
  }

  let remaining = params.amount;
  let principal = new Prisma.Decimal(0);
  let interest = new Prisma.Decimal(0);
  const allocations: AllocationResult["allocations"] = [];

  for (const inst of params.loan.installments) {
    if (remaining.lte(0)) break;

    const dueTotal = inst.principalDue.plus(inst.interestDue);
    const instRemaining = dueTotal.sub(inst.principalPaid.plus(inst.interestPaid));
    if (instRemaining.lte(0)) continue; // already PAID

    const applied = Prisma.Decimal.min(remaining, instRemaining);
    const interestRemaining = inst.interestDue.sub(inst.interestPaid);
    const interestApplied = Prisma.Decimal.min(applied, interestRemaining);
    const principalApplied = applied.sub(interestApplied);

    const newPrincipalPaid = inst.principalPaid.plus(principalApplied);
    const newInterestPaid = inst.interestPaid.plus(interestApplied);
    const isPaid = newPrincipalPaid.plus(newInterestPaid).gte(dueTotal);

    await tx.loanInstallment.update({
      where: { id: inst.id, tenantId: params.tenantId },
      data: {
        principalPaid: newPrincipalPaid,
        interestPaid: newInterestPaid,
        status: isPaid ? "PAID" : "PARTIAL",
        paidOffAt: isPaid ? params.paidAt : null
      }
    });

    await tx.loanPaymentAllocation.create({
      data: { paymentId: params.paymentId, installmentId: inst.id, principal: principalApplied, interest: interestApplied }
    });

    allocations.push({ installmentId: inst.id, seq: inst.seq, principal: principalApplied.toString(), interest: interestApplied.toString() });
    principal = principal.plus(principalApplied);
    interest = interest.plus(interestApplied);
    remaining = remaining.sub(applied);
  }

  return { principal, interest, allocations };
}
