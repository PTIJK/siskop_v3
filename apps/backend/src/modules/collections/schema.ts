import { z } from "zod";

export const setAssignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        memberId: z.string().cuid("Member ID tidak valid"),
        collectorUserId: z.string().cuid("User ID kolektor tidak valid")
      })
    )
    .min(1, "Minimal satu penugasan")
});

export const collectorDepositSchema = z.object({
  savingId: z.string().cuid("Saving ID tidak valid"),
  amount: z.coerce.number().positive("Nominal harus lebih dari 0"),
  note: z.string().optional()
});

export const collectorLoanPaymentSchema = z.object({
  loanId: z.string().cuid("Loan ID tidak valid"),
  amount: z.coerce.number().positive("Nominal harus lebih dari 0"),
  penalty: z.coerce.number().nonnegative("Denda tidak boleh negatif").default(0),
  note: z.string().optional()
});

export const verifyBatchSchema = z.object({
  receivedTotal: z.coerce.number().nonnegative("Nominal tidak boleh negatif")
});

export const listBatchesQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  collectorId: z.string().cuid("Collector ID tidak valid").optional(),
  status: z.enum(["OPEN", "SUBMITTED", "VERIFIED"]).optional()
});

export type SetAssignmentsInput = z.infer<typeof setAssignmentsSchema>;
export type CollectorDepositInput = z.infer<typeof collectorDepositSchema>;
export type CollectorLoanPaymentInput = z.infer<typeof collectorLoanPaymentSchema>;
export type VerifyBatchInput = z.infer<typeof verifyBatchSchema>;
export type ListBatchesQueryInput = z.infer<typeof listBatchesQuerySchema>;
