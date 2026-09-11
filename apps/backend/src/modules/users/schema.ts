import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
  roleId: z.string().cuid("Role tidak valid"),
  unitIds: z.array(z.string().cuid("Unit ID tidak valid")).min(1, "Pilih minimal 1 unit")
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email("Email tidak valid").optional(),
  roleId: z.string().cuid("Role tidak valid").optional(),
  isActive: z.boolean().optional(),
  // Never an empty array when present: that would fall back to "all units"
  // (see lib/unit-access.ts), the opposite of a revoke. Use isActive:false
  // to fully revoke a user instead.
  unitIds: z.array(z.string().cuid("Unit ID tidak valid")).min(1, "Pilih minimal 1 unit").optional()
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
