import { z } from 'zod';
import { SavingType, RateType } from '@siskop/shared';

export const CreateSavingConfigSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  type: z.nativeEnum(SavingType),
  rateType: z.nativeEnum(RateType),
  rate: z.coerce.number().min(0).max(100),
  periodUnit: z.enum(['MONTHLY', 'YEARLY']),
});

export const UpdateSavingConfigSchema = CreateSavingConfigSchema.partial();

export const CreateSavingSchema = z.object({
  memberId: z.string().cuid('Member ID tidak valid'),
  savingConfigId: z.string().cuid('Saving config ID tidak valid'),
  initialDeposit: z.coerce.number().min(0).default(0),
});

export const TransactionSchema = z.object({
  amount: z.coerce.number().positive('Nominal harus lebih dari 0'),
  note: z.string().optional(),
});

export const SavingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  memberId: z.string().optional(),
});

export const TxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSavingConfigInput = z.infer<typeof CreateSavingConfigSchema>;
export type UpdateSavingConfigInput = z.infer<typeof UpdateSavingConfigSchema>;
export type CreateSavingInput = z.infer<typeof CreateSavingSchema>;
export type TransactionInput = z.infer<typeof TransactionSchema>;
export type SavingQuery = z.infer<typeof SavingQuerySchema>;
