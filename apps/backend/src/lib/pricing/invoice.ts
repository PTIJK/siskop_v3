import { Prisma, type InvoiceType } from "@prisma/client";
import type { PricingQuote } from "@siskop/types";
import type { TxClient } from "../db.js";

/** "INV-YYYYMM-" is 11 characters, so the running number starts at character 12. */
const NUMBER_START = 12;

/**
 * The next INV-YYYYMM-NNNN number for the month of `now` (UTC), restarting at
 * 0001 each month. Takes a transaction-scoped advisory lock first, so
 * simultaneous callers queue up instead of reading the same maximum; the lock
 * is released when the caller's transaction ends, after its invoice is stored.
 * Past 9999 the number simply gets longer.
 */
export async function allocateInvoiceNumber(tx: TxClient, now: Date = new Date()): Promise<string> {
  const prefix = `INV-${now.toISOString().slice(0, 7).replace("-", "")}-`;
  // $executeRaw: the lock function returns void, which $queryRaw cannot deserialize.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('siskop-invoice-number'))`;
  const [row] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("number" FROM ${NUMBER_START}::int) AS INTEGER)) AS max
    FROM "Invoice" WHERE "number" LIKE ${`${prefix}%`}`;
  return `${prefix}${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

export interface CreateInvoiceInput {
  tenantId: string;
  subscriptionId: string;
  type: InvoiceType;
  /** The engine's quote for what is being billed. The invoice copies its amounts. */
  quote: PricingQuote;
  dueDate: Date;
  now?: Date;
}

/** Stores an OPEN invoice from a quote. Money is copied as Decimals; nothing is recomputed here. */
export async function createInvoice(tx: TxClient, input: CreateInvoiceInput) {
  const number = await allocateInvoiceNumber(tx, input.now);
  return tx.invoice.create({
    data: {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      number,
      type: input.type,
      subtotal: new Prisma.Decimal(input.quote.subtotal),
      taxRate: input.quote.taxRate === null ? null : new Prisma.Decimal(input.quote.taxRate),
      taxAmount: new Prisma.Decimal(input.quote.taxAmount),
      total: new Prisma.Decimal(input.quote.total),
      dueDate: input.dueDate
    }
  });
}
