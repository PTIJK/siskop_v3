import { z } from 'zod';
import { AccountCategory, MappingSourceType, MappingTransactionKind } from '@siskop/shared';

export const CreateAccountSchema = z.object({
  code: z.string().min(3, 'Kode akun wajib diisi'),
  name: z.string().min(2, 'Nama akun minimal 2 karakter'),
  category: z.nativeEnum(AccountCategory),
  parentId: z.string().cuid().nullable().optional(),
  isHeader: z.boolean().default(false),
});

export const UpdateAccountSchema = z.object({
  name: z.string().min(2, 'Nama akun minimal 2 karakter').optional(),
  isActive: z.boolean().optional(),
});

export const MarkCashEquivalentSchema = z.object({
  isCashEquivalent: z.boolean(),
});

export const AccountQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().optional(),
  category: z.nativeEnum(AccountCategory).optional(),
});

export const UpsertAccountMappingSchema = z
  .object({
    sourceType: z.nativeEnum(MappingSourceType),
    sourceId: z.string().cuid().nullable().optional(),
    transactionKind: z.nativeEnum(MappingTransactionKind),
    debitAccountId: z.string().cuid(),
    creditAccountId: z.string().cuid(),
  })
  .refine((data) => data.sourceType === 'SYSTEM' || !!data.sourceId, {
    message: 'sourceId wajib diisi kecuali untuk sourceType SYSTEM',
    path: ['sourceId'],
  });

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
export type MarkCashEquivalentInput = z.infer<typeof MarkCashEquivalentSchema>;
export type AccountQuery = z.infer<typeof AccountQuerySchema>;
export type UpsertAccountMappingInput = z.infer<typeof UpsertAccountMappingSchema>;
