import { z } from 'zod';

export const CreateMemberSchema = z.object({
  fullName: z.string().min(2, 'Nama minimal 2 karakter'),
  nik: z.string().length(16, 'NIK harus 16 digit').regex(/^\d+$/, 'NIK harus berupa angka'),
  address: z.string().min(10, 'Alamat harus lengkap'),
  birthPlace: z.string().min(2, 'Tempat lahir wajib diisi'),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal: YYYY-MM-DD'),
  occupation: z.string().min(2, 'Pekerjaan wajib diisi'),
});

export const UpdateMemberSchema = CreateMemberSchema.partial();

export const MemberQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['fullName', 'memberId', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  isActive: z.coerce.boolean().optional(),
});

export type CreateMemberInput = z.infer<typeof CreateMemberSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>;
export type MemberQuery = z.infer<typeof MemberQuerySchema>;
