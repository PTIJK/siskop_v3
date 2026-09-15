import { z } from "zod";

export const listRegistrationRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING")
});

export const rejectRegistrationRequestSchema = z.object({
  rejectionReason: z.string().min(1, "Alasan penolakan wajib diisi")
});

export type ListRegistrationRequestsQueryInput = z.infer<typeof listRegistrationRequestsQuerySchema>;
export type RejectRegistrationRequestInput = z.infer<typeof rejectRegistrationRequestSchema>;
