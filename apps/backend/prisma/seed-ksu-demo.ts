// KSU (multi-unit cooperative) week-1 spike demo seed — Day 5.
//
// Unlike prisma/seed.ts (raw Prisma upserts for a single-unit tenant, meant to
// be re-run against the long-lived dev database), this is a one-shot script
// that drives the REAL service-layer functions the HTTP routes themselves
// call (registerTenant, createUnit, createAccount, upsertAccountMapping,
// createMember, createSaving, createLoan, recordLoanPayment) rather than raw
// `db.create()` calls — so every validation rule those functions enforce
// (duplicate account codes, the hasPokokSaving guard before a loan, tenant
// ownership checks, etc.) runs exactly as it would for a real user, and the
// resulting data is indistinguishable from what the real app would produce.
//
// SAFETY: this script must be pointed at the disposable `siskop_test`
// database, never the real dev/demo database — see docs/ksu-mvp-week1-demo.md
// and the Day 5 task brief for why. It reads `DATABASE_URL`/`JWT_SECRET`/
// `JWT_REFRESH_SECRET` from the environment (no dotenv default-loading), so
// invoke it with those set explicitly, e.g.:
//
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5433/siskop_test" \
//   JWT_SECRET="test-secret" JWT_REFRESH_SECRET="test-refresh-secret" \
//   NODE_ENV="test" pnpm --filter @siskop/backend db:seed:ksu-demo
//
// Not idempotent (registerTenant's slug/registrationNo/adminEmail are all
// globally unique) — re-running against a database that already has this
// tenant will fail with a CONFLICT error rather than silently duplicating
// data. That's intentional: this script creates exactly one new tenant.
import { db } from "../src/lib/db.js";
import { registerTenant } from "../src/modules/auth/service.js";
import { createUnit, createAccount, upsertAccountMapping, listUnits } from "../src/modules/config/service.js";
import { createMember } from "../src/modules/members/service.js";
import { createSavingConfig, createSaving } from "../src/modules/savings/service.js";
import { createLoanConfig, createLoan, recordLoanPayment } from "../src/modules/loans/service.js";

const TENANT_SLUG = "ksu-sejahtera-mandiri";
const ADMIN_EMAIL = "admin@ksu-sejahtera.demo";
const ADMIN_PASSWORD = "KsuDemo123!";

async function main() {
  console.log(`Seeding KSU demo tenant against: ${process.env.DATABASE_URL}`);
  if (!process.env.DATABASE_URL?.includes("siskop_test")) {
    throw new Error(
      "Refusing to run: DATABASE_URL does not look like the siskop_test database. " +
        "This script must never be pointed at a real dev/demo database — see docs/ksu-mvp-week1-demo.md."
    );
  }

  // ── 1. Tenant + Unit A (KSP) + admin user, via the real registration flow ──
  const admin = await registerTenant({
    tenantName: "KSU Sejahtera Mandiri",
    slug: TENANT_SLUG,
    registrationNo: "KOP/KSU/2026/001",
    address: "Jl. Raya Cihampelas No. 45, Bandung, Jawa Barat",
    type: "KONVENSIONAL",
    adminName: "Rina Kartika Dewi",
    adminEmail: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    firstUnit: { type: "KSP", name: "Simpan Pinjam Unit A" }
  });
  const tenantId = admin.user.tenantId;
  const [unitA] = await listUnits(tenantId);
  if (!unitA) throw new Error("registerTenant did not provision a first unit");
  console.log(`Tenant created: ${tenantId} (slug: ${TENANT_SLUG})`);
  console.log(`Unit A: ${unitA.id} (${unitA.name})`);

  // ── 2. Unit B (KSP) — the second unit that makes this tenant a KSU ────────
  const unitB = await createUnit(tenantId, { type: "KSP", name: "Simpan Pinjam Unit B" });
  console.log(`Unit B: ${unitB.id} (${unitB.name})`);

  // ── 3. Accounting entitlement — GET /api/ksu/* requires the "accounting" ──
  //      package module, same gate as the Neraca/SHU regulatory reports.
  const pkg = await db.subscriptionPackage.upsert({
    where: { id: "pkg_ksu_demo" },
    update: {},
    create: {
      id: "pkg_ksu_demo",
      name: "Paket KSU Demo",
      price: 0,
      modules: ["accounting"],
      maxUsers: 20,
      maxMembers: 500,
      maxSavingConfigs: null,
      whitelabelEnabled: false,
      isActive: true
    }
  });
  await db.tenant.update({ where: { id: tenantId }, data: { packageId: pkg.id } });
  console.log("Accounting entitlement granted");

  // ── 4. Minimal Chart of Accounts, via the real config service (not raw ────
  //      inserts) so duplicate-code / validation rules apply exactly as they
  //      would for a real user filling in Konfigurasi > Chart of Accounts.
  const kas = await createAccount(tenantId, {
    code: "1-1000",
    name: "Kas",
    category: "ASET",
    normalBalance: "DEBIT",
    isHeader: false,
    isCashEquivalent: true
  });
  const piutang = await createAccount(tenantId, {
    code: "1-1100",
    name: "Piutang Pinjaman Anggota",
    category: "ASET",
    normalBalance: "DEBIT",
    isHeader: false,
    isCashEquivalent: false
  });
  // Deliberately EKUITAS, not Kas/ASET — mirrors tests/ksu-consolidation.test.ts's
  // own account setup exactly, so each loan's net ASET contribution equals its
  // principal and GET /api/ksu/consolidated reports clean, hand-verifiable
  // per-unit totals for this demo (isolated from the separate question of
  // whether Kas is pooled or segregated per unit — out of scope for this spike).
  const modalKerja = await createAccount(tenantId, {
    code: "3-1000",
    name: "Modal Kerja",
    category: "EKUITAS",
    normalBalance: "KREDIT",
    isHeader: false,
    isCashEquivalent: false
  });
  const simpananPokok = await createAccount(tenantId, {
    code: "3-2000",
    name: "Simpanan Pokok",
    category: "EKUITAS",
    normalBalance: "KREDIT",
    isHeader: false,
    isCashEquivalent: false
  });
  const pendapatanBunga = await createAccount(tenantId, {
    code: "4-1000",
    name: "Pendapatan Bunga Pinjaman",
    category: "PENDAPATAN",
    normalBalance: "KREDIT",
    isHeader: false,
    isCashEquivalent: false
  });
  console.log("Chart of accounts created");

  // ── 5. Loan config + mappings ──────────────────────────────────────────────
  const loanConfig = await createLoanConfig(tenantId, {
    name: "Pinjaman Modal Usaha",
    type: "KONVENSIONAL",
    rateType: "BUNGA",
    rate: 12,
    maxTermMonths: 24
  });
  await upsertAccountMapping(tenantId, {
    sourceType: "LOAN_CONFIG",
    sourceId: loanConfig.id,
    transactionKind: "DISBURSEMENT",
    debitAccountId: piutang.id,
    creditAccountId: modalKerja.id
  });
  await upsertAccountMapping(tenantId, {
    sourceType: "LOAN_CONFIG",
    sourceId: loanConfig.id,
    transactionKind: "PAYMENT_PRINCIPAL",
    debitAccountId: kas.id,
    creditAccountId: piutang.id
  });
  await upsertAccountMapping(tenantId, {
    sourceType: "LOAN_CONFIG",
    sourceId: loanConfig.id,
    transactionKind: "PAYMENT_INTEREST",
    debitAccountId: kas.id,
    creditAccountId: pendapatanBunga.id
  });
  console.log("Loan config + account mappings created");

  // ── 6. Saving config (Pokok) + mapping ─────────────────────────────────────
  const pokokConfig = await createSavingConfig(tenantId, {
    name: "Simpanan Pokok",
    type: "POKOK",
    rateType: "BUNGA",
    rate: 0,
    periodUnit: "MONTHLY"
  });
  await upsertAccountMapping(tenantId, {
    sourceType: "SAVING_CONFIG",
    sourceId: pokokConfig.id,
    transactionKind: "DEPOSIT",
    debitAccountId: kas.id,
    creditAccountId: simpananPokok.id
  });
  console.log("Saving config + mapping created");

  // ── 7. SHU distribution config — feeds getMemberUnitStatement's per-unit ──
  //      split (40% jasaSimpanan / 40% jasaPinjaman / 10% cadangan / 10% lainnya).
  await db.shuDistributionConfig.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, jasaSimpananPercent: 40, jasaPinjamanPercent: 40, cadanganPercent: 10, lainnyaPercent: 10 }
  });
  console.log("SHU distribution config created");

  // ── 8. Members ──────────────────────────────────────────────────────────────
  async function member(fullName: string, nik: string) {
    return createMember(tenantId, {
      fullName,
      nik,
      address: "Jl. Contoh Alamat No. 1, Bandung, Jawa Barat",
      birthPlace: "Bandung",
      birthDate: "1988-05-10",
      occupation: "Wiraswasta"
    });
  }
  const made = await member("Made Suryawan", "3273010101880001");
  const siti = await member("Siti Rahmawati", "3273010101880002");
  const budi = await member("Budi Setiawan", "3273010101880003");
  console.log("3 members created");

  // Every member needs an active Simpanan Pokok before a loan can be issued
  // (modules/loans/service.ts#createLoan's hasPokokSaving guard) — and, per
  // lib/units.ts#getDefaultUnitId, a Saving ALWAYS lands on Unit A: savings has
  // no unit-picker yet (documented KNOWN LIMITATION — see modules/ksu/service.ts
  // and docs/ksu-mvp-week1-demo.md).
  await createSaving(tenantId, { memberId: made.id, savingConfigId: pokokConfig.id, initialDeposit: 500_000 }, admin.user.id);
  await createSaving(tenantId, { memberId: siti.id, savingConfigId: pokokConfig.id, initialDeposit: 500_000 }, admin.user.id);
  await createSaving(tenantId, { memberId: budi.id, savingConfigId: pokokConfig.id, initialDeposit: 500_000 }, admin.user.id);
  console.log("Simpanan Pokok opened for all 3 members (all land on Unit A)");

  // ── 9. Loans — one disbursed in each unit, via Day 2's explicit unitId ────
  //      override for Unit B. Siti's loan lands in Unit B while her savings
  //      sit in Unit A (unavoidable, see above) — that combination makes her
  //      the demo's "active in both units" member for
  //      GET /api/ksu/members/:memberId/statement.
  const loanMade = await createLoan(
    tenantId,
    { memberId: made.id, loanConfigId: loanConfig.id, principalAmount: 5_000_000, termMonths: 12, force: false },
    admin.user.id
  );
  const loanBudi = await createLoan(
    tenantId,
    { memberId: budi.id, loanConfigId: loanConfig.id, principalAmount: 3_000_000, termMonths: 12, force: false },
    admin.user.id
  );
  const loanSiti = await createLoan(
    tenantId,
    {
      memberId: siti.id,
      loanConfigId: loanConfig.id,
      principalAmount: 8_000_000,
      termMonths: 12,
      unitId: unitB.id,
      force: false
    },
    admin.user.id
  );
  if ("hasExistingLoan" in loanMade || "hasExistingLoan" in loanBudi || "hasExistingLoan" in loanSiti) {
    throw new Error("Unexpected pre-existing active loan on a freshly seeded member");
  }
  console.log(
    `3 loans disbursed — Unit A: Made Rp5,000,000 + Budi Rp3,000,000 (Rp8,000,000 total); ` +
      `Unit B: Siti Rp8,000,000`
  );

  // ── 10. One payment per loan this month, so getMemberUnitStatement's ─────
  //       default (current-calendar-month) period has real interest income to
  //       distribute — without this, shuBerjalan would be 0 and every member's
  //       statement would report shu: 0 for every unit.
  const todayStr = new Date().toISOString().split("T")[0] as string;
  await recordLoanPayment(
    tenantId,
    loanMade.id,
    { amount: Number(loanMade.monthlyPayment), penalty: 0, paidAt: todayStr, dueDate: todayStr },
    admin.user.id
  );
  await recordLoanPayment(
    tenantId,
    loanBudi.id,
    { amount: Number(loanBudi.monthlyPayment), penalty: 0, paidAt: todayStr, dueDate: todayStr },
    admin.user.id
  );
  await recordLoanPayment(
    tenantId,
    loanSiti.id,
    { amount: Number(loanSiti.monthlyPayment), penalty: 0, paidAt: todayStr, dueDate: todayStr },
    admin.user.id
  );
  console.log("One payment recorded on each loan");

  console.log("");
  console.log("KSU demo seed complete!");
  console.log("");
  console.log(`  Tenant slug:   ${TENANT_SLUG}`);
  console.log(`  Admin login:   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Unit A id:     ${unitA.id} (${unitA.name})`);
  console.log(`  Unit B id:     ${unitB.id} (${unitB.name})`);
  console.log(`  Member ids:    Made=${made.id}  Siti=${siti.id} (active in both units)  Budi=${budi.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
