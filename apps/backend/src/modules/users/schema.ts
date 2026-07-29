import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
  roleId: z.string().cuid("Role tidak valid")
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email("Email tidak valid").optional(),
  roleId: z.string().cuid("Role tidak valid").optional(),
  isActive: z.boolean().optional()
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
