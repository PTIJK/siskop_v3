import bcrypt from "bcryptjs";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";
import { login, registerTenant, type RegisterTenantInput } from "../src/modules/auth/service.js";

export const app = () => createApp();

export const DEFAULT_MEMBER = {
  fullName: "Budi Santoso",
  nik: "3171234567890001",
  address: "Jl. Kebon Jeruk No. 5, Jakarta Barat",
  birthPlace: "Jakarta",
  birthDate: "1985-03-15",
  occupation: "Pedagang"
};

/** Creates a member via the real API (not a direct DB insert) using the given access token. */
export async function createMemberAs(accessToken: string, overrides: Partial<typeof DEFAULT_MEMBER> = {}) {
  const res = await request(app())
    .post("/api/members")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ ...DEFAULT_MEMBER, ...overrides });
  return res.body.data as { id: string };
}

/** A member with an active simpanan pokok — the precondition Loans requires before issuing any loan. */
export async function createMemberWithPokokSaving(
  accessToken: string,
  overrides: Partial<typeof DEFAULT_MEMBER> = {}
) {
  const member = await createMemberAs(accessToken, overrides);
  const config = await request(app())
    .post("/api/savings/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Simpanan Pokok", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
  await request(app())
    .post("/api/savings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ memberId: member.id, savingConfigId: config.body.data.id, initialDeposit: 500_000 });
  return member;
}

export const DEFAULT_REGISTRATION: RegisterTenantInput = {
  tenantName: "KSP Demo",
  slug: "demo",
  registrationNo: "KOP-DEMO",
  address: "Jl. Demo 1",
  type: "KONVENSIONAL",
  adminName: "Admin Demo",
  adminEmail: "admin@demo.test",
  password: "rahasia123",
  firstUnit: { type: "KSP", name: "Simpan Pinjam" }
};

/** Registers a fresh tenant (+ unit, 4 seed roles, Super Admin user) and logs the admin in. */
export async function setupTenant(overrides: Partial<RegisterTenantInput> = {}) {
  return registerTenant({ ...DEFAULT_REGISTRATION, ...overrides });
}

/** Creates a staff user under one of the tenant's seeded roles and logs them in. */
export async function createStaffSession(
  tenantId: string,
  slug: string,
  roleName: "Super Admin" | "Manager" | "Teller" | "Viewer",
  email: string
) {
  const role = await db.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
  await db.user.create({
    data: {
      tenantId,
      roleId: role.id,
      email,
      name: roleName,
      passwordHash: await bcrypt.hash("rahasia123", 10)
    }
  });
  return login(slug, email, "rahasia123");
}
