import { z } from 'zod';
import { TenantType } from '@siskop/shared';

export const RegisterTenantSchema = z.object({
  name: z.string().min(3, 'Nama koperasi minimal 3 karakter'),
  address: z.string().min(10, 'Alamat harus lengkap'),
  registrationNo: z.string().min(5, 'Nomor pendaftaran tidak valid'),
  type: z.nativeEnum(TenantType),
  cooperativeType: z.string().default('Koperasi Simpan Pinjam'),
  adminName: z.string().min(2, 'Nama admin minimal 2 karakter'),
  adminEmail: z.string().email('Email tidak valid'),
  adminPassword: z
    .string()
    .min(8, 'Password minimal 8 karakter')
    .regex(/[A-Z]/, 'Password harus mengandung huruf kapital')
    .regex(/[0-9]/, 'Password harus mengandung angka'),
});

export const LoginSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
});

export type RegisterTenantInput = z.infer<typeof RegisterTenantSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
