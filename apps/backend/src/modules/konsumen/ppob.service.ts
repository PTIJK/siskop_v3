import { Prisma } from "@prisma/client";
import type { CheckPPOBBillResponse, PayPPOBBillResponse } from "@siskop/types";
import { db } from "../../lib/db.js";
import { resolveUnitId } from "../../lib/units.js";
import type { CheckPPOBBillInput, PayPPOBBillInput } from "./ppob.schema.js";

/**
 * PPOB (Payment Point Online Bank — pay electricity/phone-credit/BPJS/water
 * bills) is a deliberate STUB in this MVP: there is no real biller
 * integration, no external HTTP call, no new dependency. `checkBill`/`payBill`
 * both route through the pure `simulateBill()` below so a check-then-pay
 * round trip is internally consistent — the amount `payBill` writes is always
 * exactly what `checkBill` would have just quoted for the same
 * (billType, customerNumber), never a client-supplied figure.
 *
 * Known gap (future work, once a real biller integration exists): no journal
 * entry is posted for PPOB — this module never touches lib/journal.ts or
 * AccountMapping. A `PPOBTransaction` row is only an audit trail, not a
 * balanced double-entry posting like POS sales/savings/loans get.
 */

const SIMULATED_CUSTOMER_NAME = "Pelanggan Demo";
const BASE_AMOUNT = 50_000; // Rp 50.000 floor
const AMOUNT_STEP = 10_000; // Rp 10.000 per bucket
const AMOUNT_BUCKETS = 51; // buckets 0..50 -> ceiling Rp 50_000 + 50*10_000 = Rp 550_000
const FIXED_ADMIN_FEE = 2_500; // Rp 2.500 flat, regardless of billType (a simple, documented stub choice)

export interface SimulatedBill {
  amount: number;
  adminFee: number;
  customerName: string;
}

/**
 * Pure, deterministic bill simulator — no randomness, no `Date.now()`. The
 * same `(billType, customerNumber)` pair always produces the same result.
 *
 * Formula: sum the decimal digits found in `customerNumber` (non-digit
 * characters such as dashes/letters are ignored), reduce that sum modulo 51
 * to a 0-50 bucket, then map the bucket onto Rp 50.000..Rp 550.000 in
 * Rp 10.000 steps:
 *
 *   digitSum = sum of every /\d/ character in customerNumber
 *   amount   = 50_000 + (digitSum % 51) * 10_000
 *
 * Worked example: customerNumber "123456789" -> digits 1+2+3+4+5+6+7+8+9 = 45;
 * 45 % 51 = 45; amount = 50_000 + 45 * 10_000 = 500_000.
 *
 * `billType` is currently not part of the formula — Rp 50.000-Rp 550.000 is a
 * plausible range for every bill type this MVP lists (LISTRIK/PULSA/BPJS/AIR)
 * and keeping one formula keeps the stub simple and reviewable. `adminFee` is
 * a flat Rp 2.500 for the same reason. `customerName` is always the obviously
 * fake "Pelanggan Demo", matching the "simulation" framing.
 */
export function simulateBill(_billType: string, customerNumber: string): SimulatedBill {
  const digitSum = (customerNumber.match(/\d/g) ?? []).reduce((sum, digit) => sum + Number(digit), 0);
  const bucket = digitSum % AMOUNT_BUCKETS;

  return {
    amount: BASE_AMOUNT + bucket * AMOUNT_STEP,
    adminFee: FIXED_ADMIN_FEE,
    customerName: SIMULATED_CUSTOMER_NAME
  };
}

/** Pure read — simulates and returns a quote, writes nothing to the database. */
export async function checkBill(tenantId: string, data: CheckPPOBBillInput): Promise<CheckPPOBBillResponse> {
  // Still validates the unit belongs to tenantId even though nothing is
  // persisted here — a caller must not be able to probe whether a unitId
  // exists across tenants via this endpoint either (CLAUDE.md rule 1).
  await resolveUnitId(tenantId, data.unitId);

  const simulated = simulateBill(data.billType, data.customerNumber);
  return {
    amount: new Prisma.Decimal(simulated.amount).toString(),
    adminFee: new Prisma.Decimal(simulated.adminFee).toString(),
    customerName: simulated.customerName
  };
}

/**
 * Records the payment as a `PPOBTransaction` row with `status: "PAID"`.
 * Re-derives `amount`/`adminFee` via `simulateBill()` — anything the client
 * sent for either is ignored (see ppob.schema.ts's doc on why `amount` isn't
 * even accepted). No journal entry is posted — see this module's doc.
 */
export async function payBill(
  tenantId: string,
  data: PayPPOBBillInput,
  createdBy: string
): Promise<PayPPOBBillResponse> {
  const unitId = await resolveUnitId(tenantId, data.unitId);

  const simulated = simulateBill(data.billType, data.customerNumber);

  const transaction = await db.pPOBTransaction.create({
    data: {
      tenantId,
      unitId,
      billType: data.billType,
      customerNumber: data.customerNumber,
      customerName: simulated.customerName,
      amount: simulated.amount,
      adminFee: simulated.adminFee,
      status: "PAID",
      createdBy
    }
  });

  return { id: transaction.id, status: transaction.status };
}
