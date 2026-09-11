import { z } from "zod";

const billTypeSchema = z.enum(["LISTRIK", "PULSA", "BPJS", "AIR"], {
  errorMap: () => ({ message: "Tipe tagihan harus LISTRIK, PULSA, BPJS, atau AIR" })
});

export const checkPPOBBillSchema = z.object({
  unitId: z.string().cuid("Unit ID tidak valid"),
  billType: billTypeSchema,
  customerNumber: z.string().min(1, "Nomor pelanggan wajib diisi")
});

/**
 * Deliberately has NO `amount` field: the paid amount is always re-derived
 * server-side from `simulateBill()` (see ppob.service.ts), never trusted from
 * the client — this is the whole point of the "don't trust client-supplied
 * money" rule even on a stub. `adminFee` is accepted for API-contract
 * symmetry with the /check response the frontend echoes back, but its value
 * is likewise ignored — payBill() re-simulates it too.
 *
 * A client sending an extra `amount` field anyway is harmless: zod's default
 * (non-strict) `.parse()` just omits unrecognized keys from its output, so
 * `PayPPOBBillInput` never carries one for the service layer to (mis)use.
 */
export const payPPOBBillSchema = z.object({
  unitId: z.string().cuid("Unit ID tidak valid"),
  billType: billTypeSchema,
  customerNumber: z.string().min(1, "Nomor pelanggan wajib diisi"),
  adminFee: z.string().optional()
});

export type CheckPPOBBillInput = z.infer<typeof checkPPOBBillSchema>;
export type PayPPOBBillInput = z.infer<typeof payPPOBBillSchema>;
