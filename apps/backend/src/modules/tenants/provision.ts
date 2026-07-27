import { z } from "zod";
import { db } from "../../lib/db.js";
import { CooperativeType } from "@siskop/types";

const unitInput = z.object({
  type: z.nativeEnum(CooperativeType),
  name: z.string().min(1)
});

// `firstUnit` is a required scalar rather than an array with `.min(1)`, so the
// type system — not a runtime check — makes a unitless tenant unconstructible
// at every call site.
const provisionInput = z.object({
  name: z.string().min(1),
  cooperativeId: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  address: z.string().min(1),
  firstUnit: unitInput,
  additionalUnits: z.array(unitInput).default([])
});

export type ProvisionTenantInput = z.input<typeof provisionInput>;

export async function provisionTenant(input: ProvisionTenantInput) {
  const data = provisionInput.parse(input);
  const units = [data.firstUnit, ...data.additionalUnits];

  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: data.name,
        cooperativeId: data.cooperativeId,
        email: data.email,
        phone: data.phone,
        address: data.address
      }
    });

    await tx.cooperativeUnit.createMany({
      data: units.map((u) => ({ tenantId: tenant.id, type: u.type, name: u.name }))
    });

    return tenant;
  });
}
