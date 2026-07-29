import { z } from "zod";
import { CooperativeType } from "@siskop/types";
import { slugSchema } from "../tenants/provision.js";

export const createTenantSchema = z.object({
  tenantName: z.string().min(1),
  slug: slugSchema,
  registrationNo: z.string().min(1),
  address: z.string().min(1),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  cooperativeType: z.string().min(1).default("KSP"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8, "password must be at least 8 characters"),
  firstUnit: z.object({ type: z.nativeEnum(CooperativeType), name: z.string().min(1) })
});

export type CreateTenantInput = z.input<typeof createTenantSchema>;

export const updateTenantStatusSchema = z.object({
  isActive: z.boolean().optional(),
  packageId: z.string().cuid().nullable().optional(),
  nextBillingDate: z.coerce.date().nullable().optional()
});
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;

const entitlementModuleSchema = z.enum(["accounting"]);

export const createPackageSchema = z.object({
  name: z.string().min(2, "Nama paket minimal 2 karakter"),
  price: z.coerce.number().min(0),
  modules: z.array(entitlementModuleSchema),
  maxUsers: z.coerce.number().int().min(1),
  maxMembers: z.coerce.number().int().min(1),
  maxSavingConfigs: z.coerce.number().int().min(0).nullable().optional(),
  whitelabelEnabled: z.boolean().optional()
});
export type CreatePackageInput = z.infer<typeof createPackageSchema>;

export const updatePackageSchema = createPackageSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

export const createPlatformAdminSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  email: z.string().email("Email tidak valid"),
  password: z
    .string()
    .min(8, "Password minimal 8 karakter")
    .regex(/[A-Z]/, "Password harus mengandung huruf besar")
    .regex(/[0-9]/, "Password harus mengandung angka")
});
export type CreatePlatformAdminInput = z.infer<typeof createPlatformAdminSchema>;

export const updatePlatformAdminSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email("Email tidak valid").optional(),
  isActive: z.boolean().optional()
});
export type UpdatePlatformAdminInput = z.infer<typeof updatePlatformAdminSchema>;
