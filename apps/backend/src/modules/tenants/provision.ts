import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Permissions } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { CooperativeType } from "@siskop/types";

const unitInput = z.object({
  type: z.nativeEnum(CooperativeType),
  name: z.string().min(1)
});

// `firstUnit` is a required scalar rather than an array with `.min(1)`, so the
// type system — not a runtime check — makes a unitless tenant unconstructible
// at every call site.
// Slug is the login subdomain, so it is constrained to what a hostname label
// may contain: lowercase alphanumerics and interior hyphens, nothing else.
export const slugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "slug must be a valid hostname label");

const provisionInput = z.object({
  name: z.string().min(1),
  slug: slugSchema,
  registrationNo: z.string().min(1),
  address: z.string().min(1),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  cooperativeType: z.string().min(1).default("KSP"),
  firstUnit: unitInput,
  additionalUnits: z.array(unitInput).default([])
});

export type ProvisionTenantInput = z.input<typeof provisionInput>;

type Tx = TxClient;

const FULL: Permissions["members"] = { create: true, read: true, update: true, delete: true };
const READ_ONLY = { read: true };

/**
 * Every tenant is seeded with these 4 roles at provisioning time (ported
 * verbatim from the pre-rescaffold demo seed, now created for every tenant —
 * not just the demo — so RBAC works out of the box). `Role`/`Permissions` are
 * the fine-grained axis; `AuthClaims.role` (super_admin|tenant_admin|
 * accountant|member) is the separate, coarse axis — see packages/types/src/role.ts.
 */
const SEED_ROLES: Array<{ name: string; permissions: Permissions }> = [
  {
    name: "Super Admin",
    permissions: {
      dashboard: READ_ONLY,
      members: FULL,
      savings: FULL,
      loans: FULL,
      reports: { read: true, export: true, update: true },
      config: { read: true, update: true },
      users: FULL,
      roles: FULL,
      accounting: FULL,
      konsumen: FULL
    }
  },
  {
    name: "Manager",
    permissions: {
      dashboard: READ_ONLY,
      members: FULL,
      savings: FULL,
      loans: FULL,
      reports: { read: true, export: true, update: true },
      config: { read: true, update: false },
      users: { create: false, read: true, update: false, delete: false },
      roles: { read: true },
      accounting: { create: false, read: false, update: false, delete: false },
      konsumen: FULL
    }
  },
  {
    name: "Teller",
    permissions: {
      dashboard: READ_ONLY,
      members: READ_ONLY,
      savings: { create: true, read: true, update: true, delete: false },
      loans: { read: true, update: true },
      reports: {},
      config: {},
      users: {},
      roles: {},
      // Front-counter staff record stock movements and ring up POS sales
      // (create) but don't add/remove SKUs — that's Manager territory.
      konsumen: { create: true, read: true, update: true }
    }
  },
  {
    name: "Viewer",
    permissions: {
      dashboard: READ_ONLY,
      members: READ_ONLY,
      savings: READ_ONLY,
      loans: READ_ONLY,
      reports: READ_ONLY,
      config: {},
      users: {},
      roles: {},
      konsumen: READ_ONLY
    }
  },
  {
    name: "Kasir",
    permissions: {
      // Toko-only: konsumen access and nothing else. No members/savings/loans/
      // reports/config/users/roles/accounting — a Kasir cannot reach any
      // other module's data even before unit scoping is considered.
      dashboard: READ_ONLY,
      members: {},
      savings: {},
      loans: {},
      reports: {},
      config: {},
      users: {},
      roles: {},
      konsumen: { create: true, read: true, update: true }
    }
  }
];

/** Creates tenant + units + the 4 seed roles inside a caller-supplied transaction. */
export async function provisionTenantInTx(tx: Tx, input: ProvisionTenantInput) {
  const data = provisionInput.parse(input);
  const units = [data.firstUnit, ...data.additionalUnits];

  const tenant = await tx.tenant.create({
    data: {
      name: data.name,
      slug: data.slug,
      registrationNo: data.registrationNo,
      address: data.address,
      type: data.type,
      cooperativeType: data.cooperativeType
    }
  });

  await tx.cooperativeUnit.createMany({
    data: units.map((u) => ({ tenantId: tenant.id, type: u.type, name: u.name }))
  });

  const roles = await Promise.all(
    SEED_ROLES.map((r) =>
      tx.role.create({
        data: {
          tenantId: tenant.id,
          name: r.name,
          permissions: r.permissions as unknown as Prisma.InputJsonValue
        }
      })
    )
  );

  return { tenant, roles };
}

export async function provisionTenant(input: ProvisionTenantInput) {
  return db.$transaction((tx) => provisionTenantInTx(tx, input));
}
