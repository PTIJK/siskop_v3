import bcrypt from "bcryptjs";
import { db } from "../src/lib/db.js";
import { createTenant } from "../src/modules/platform/service.js";
import { firebaseAuth } from "../src/modules/onboarding/firebase.js";

if (process.env.DATABASE_URL !== "postgresql://postgres:local-test-only@127.0.0.1:55433/siskop_tenant_preview" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9109" || process.env.FIREBASE_PROJECT_ID !== "demo-siskop-tenants") {
  throw new Error("This fixture is restricted to the isolated preview database and local Firebase emulator");
}
try {
  const pkg = await db.subscriptionPackage.upsert({ where: { id: "tenant-preview-package" }, update: {},
    create: { id: "tenant-preview-package", name: "Preview premium", price: 100000, maxUsers: 10, maxMembers: 100, modules: [], customSubdomainEnabled: true } });
  for (const name of ["alpha", "beta"]) {
    const email = `${name}@tenant-preview.test`;
    const existing = await db.tenant.findUnique({ where: { registrationNo: `TENANT-PREVIEW-${name}` } });
    if (existing) continue;
    try { const user = await firebaseAuth().getUserByEmail(email); await firebaseAuth().deleteUser(user.uid); }
    catch (error) { if ((error as { code?: string }).code !== "auth/user-not-found") throw error; }
    const tenant = await createTenant({ tenantName: `Koperasi ${name.toUpperCase()} Preview`, slug: `${name}-preview`, registrationNo: `TENANT-PREVIEW-${name}`,
      address: "Jakarta preview", type: "KONVENSIONAL", adminName: `Admin ${name}`, adminEmail: email, adminPassword: "Preview-only-123", firstUnit: { type: "KSP", name: "Simpan pinjam" } });
    await db.tenant.update({ where: { id: tenant.id }, data: { packageId: pkg.id } });
  }
  const alpha = await db.tenant.findUniqueOrThrow({ where: { registrationNo: "TENANT-PREVIEW-alpha" }, include: { users: true, roles: true } });
  const beta = await db.tenant.findUniqueOrThrow({ where: { registrationNo: "TENANT-PREVIEW-beta" }, include: { users: true, roles: true } });
  // Alpha's admin is the single-membership account. Beta's admin gets an explicitly
  // invited, narrower role in Alpha; no staging memberships are used or changed.
  const betaAdmin = beta.users.find(u => u.email === "beta@tenant-preview.test")!;
  const identity = await db.accountIdentity.findUniqueOrThrow({ where: { firebaseUid: betaAdmin.firebaseUid! } });
  const role = alpha.roles.find(r => r.name === "Teller")!;
  await db.user.upsert({ where: { tenantId_email: { tenantId: alpha.id, email: betaAdmin.email } }, update: {},
    create: { tenantId: alpha.id, email: betaAdmin.email, name: "Multi-tenant preview staff", roleId: role.id, identityId: identity.id, authProvider: "password" } });
  await db.member.upsert({ where: { tenantId_nik: { tenantId: alpha.id, nik: "1234556787654321" } }, update: {},
    create: { tenantId: alpha.id, nik: "1234556787654321", memberId: "PREVIEW-MEMBER-001", accountNumber: "PREVIEW-ACCOUNT-001",
      fullName: "Anggota Preview", address: "Synthetic preview", birthPlace: "Jakarta", birthDate: new Date("1990-01-01"), occupation: "Preview",
      passwordHash: await bcrypt.hash("Member-preview-123", 10), mustChangePassword: false } });
  for (const tenant of [alpha, beta]) {
    await db.member.upsert({ where: { tenantId_nik: { tenantId: tenant.id, nik: "9876543210987654" } }, update: {},
      create: { tenantId: tenant.id, nik: "9876543210987654", memberId: `PREVIEW-MULTI-${tenant.slug}`, accountNumber: `PREVIEW-MULTI-ACC-${tenant.slug}`,
        fullName: "Anggota Multi Preview", address: "Synthetic preview", birthPlace: "Jakarta", birthDate: new Date("1990-01-01"), occupation: "Preview",
        passwordHash: await bcrypt.hash("Member-multi-preview-123", 10), mustChangePassword: false } });
  }
  console.info("Isolated single/multi-tenant staff and synthetic member accounts are ready.");
} finally { await db.$disconnect(); }
