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
  console.info("Two isolated tenant preview accounts are ready.");
} finally { await db.$disconnect(); }
