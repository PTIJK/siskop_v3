import { z } from "zod";

const rentPeriodSchema = z.enum(["MONTHLY", "YEARLY"]);

export const createStallContractSchema = z.object({
  stallId: z.string().cuid("Kios ID tidak valid"),
  memberId: z.string().cuid("Anggota ID tidak valid"),
  startDate: z.coerce.date(),
  rentAmount: z.coerce.number().positive("Nilai sewa harus lebih dari 0"),
  rentPeriod: rentPeriodSchema
});

export const endStallContractSchema = z.object({
  endDate: z.coerce.date().optional()
});

export const listStallContractsQuerySchema = z.object({
  stallId: z.string().cuid("Kios ID tidak valid").optional(),
  memberId: z.string().cuid("Anggota ID tidak valid").optional(),
  isActive: z.coerce.boolean().optional()
});

export type CreateStallContractInput = z.infer<typeof createStallContractSchema>;
export type EndStallContractInput = z.infer<typeof endStallContractSchema>;
export type ListStallContractsQueryInput = z.infer<typeof listStallContractsQuerySchema>;
