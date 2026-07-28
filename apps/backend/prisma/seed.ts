import {
  PrismaClient,
  TenantType,
  SavingType,
  RateType,
  LoanType,
  NotificationType,
  AccountCategory,
  NormalBalance,
  MappingSourceType,
  MappingTransactionKind,
  CalkSection
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

interface AccountSeed {
  key: string;
  code: string;
  name: string;
  category: AccountCategory;
  normalBalance: NormalBalance;
  isHeader?: boolean;
  isCashEquivalent?: boolean;
  parentKey?: string;
}

// Standard COA template — Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md §4.
// Seeded here (rather than left for the tenant to configure by hand) so the
// demo/Barokah tenants have a real ledger before seed-demo-transactions.mjs
// posts through the API; without accounts + mappings existing first, every
// transaction's JournalEntry would post as UNPOSTED_MISSING_MAPPING and the
// regulatory reports (Neraca/Arus Kas/Laporan Hasil Usaha/SHU) would be empty.
const COA_TEMPLATE: AccountSeed[] = [
  { key: "kas", code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true },
  { key: "bank", code: "1-1010", name: "Bank", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true },
  { key: "piutang_pinjaman", code: "1-1100", name: "Piutang Pinjaman Anggota", category: "ASET", normalBalance: "DEBIT" },
  {
    key: "penyisihan_piutang",
    code: "1-1190",
    name: "Penyisihan Kerugian Piutang",
    category: "ASET",
    normalBalance: "KREDIT" // contra-asset — credit-normal, reduces Piutang Pinjaman Anggota
  },
  { key: "aset_tetap", code: "1-2000", name: "Aset Tetap", category: "ASET", normalBalance: "DEBIT", isHeader: true },
  { key: "simpanan_sukarela", code: "2-1000", name: "Simpanan Sukarela — Anggota", category: "KEWAJIBAN", normalBalance: "KREDIT" },
  { key: "utang_usaha", code: "2-1100", name: "Utang Usaha", category: "KEWAJIBAN", normalBalance: "KREDIT" },
  { key: "simpanan_pokok", code: "3-1000", name: "Simpanan Pokok", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "simpanan_wajib", code: "3-1100", name: "Simpanan Wajib", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "cadangan", code: "3-2000", name: "Cadangan / Modal Penyertaan", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "shu_berjalan", code: "3-3000", name: "SHU Tahun Berjalan", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "shu_lalu", code: "3-3100", name: "SHU Tahun Lalu Belum Dibagi", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "pendapatan_bunga", code: "4-1000", name: "Pendapatan Bunga/Margin Pinjaman", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "pendapatan_admin", code: "4-2000", name: "Pendapatan Jasa Administrasi", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "pendapatan_lain", code: "4-9000", name: "Pendapatan Lain-lain", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "beban_bunga_simpanan", code: "5-1000", name: "Beban Bunga/Bagi Hasil Simpanan", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_gaji", code: "5-2000", name: "Beban Operasional — Gaji", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_sewa", code: "5-2100", name: "Beban Sewa", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_penyisihan", code: "5-3000", name: "Beban Penyisihan Kerugian Piutang", category: "BEBAN", normalBalance: "DEBIT" },
  { key: "beban_lain", code: "5-9000", name: "Beban Lain-lain", category: "BEBAN", normalBalance: "DEBIT" }
];

const CALK_NARRATIVE: Record<CalkSection, string> = {
  UMUM:
    "Koperasi didirikan berdasarkan prinsip kekeluargaan untuk meningkatkan kesejahteraan ekonomi anggota melalui layanan simpan pinjam. Laporan keuangan ini disusun untuk periode berjalan sesuai dengan Peraturan Menteri Koperasi dan UKM No. 2 Tahun 2024.",
  DASAR_PENYUSUNAN:
    "Laporan keuangan disusun berdasarkan Standar Akuntansi Keuangan Entitas Privat (SAK EP) yang berlaku efektif sejak 1 Januari 2025, menggantikan PSAK 27 yang telah dicabut. Laporan disajikan menggunakan dasar akrual dan konsep kelangsungan usaha.",
  KEBIJAKAN_AKUNTANSI:
    "Simpanan Pokok dan Simpanan Wajib dicatat sebagai bagian dari Ekuitas (modal anggota) karena bersifat tidak dapat ditarik selama anggota masih aktif. Simpanan Sukarela dicatat sebagai Kewajiban karena dapat ditarik sewaktu-waktu. Pendapatan bunga/margin pinjaman diakui secara proporsional berdasarkan porsi pokok dan bunga pada setiap angsuran yang diterima.",
  INFORMASI_TAMBAHAN:
    "Tidak terdapat peristiwa material setelah tanggal laporan yang memerlukan penyesuaian atau pengungkapan tambahan pada periode ini."
};

async function seedAccounting(
  tenantId: string,
  savingConfigIds: { POKOK: string; WAJIB: string; SUKARELA: string },
  loanConfigIds: string[]
) {
  const accountIdByKey = new Map<string, string>();
  for (const acc of COA_TEMPLATE) {
    const id = `${tenantId}_acc_${acc.key}`;
    accountIdByKey.set(acc.key, id);
    const parentId = acc.parentKey ? accountIdByKey.get(acc.parentKey) : undefined;
    await prisma.account.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normalBalance: acc.normalBalance,
        isHeader: acc.isHeader ?? false,
        isCashEquivalent: acc.isCashEquivalent ?? false,
        isDefault: true,
        isActive: true,
        ...(parentId ? { parentId } : {})
      }
    });
  }

  const kas = accountIdByKey.get("kas")!;
  const piutang = accountIdByKey.get("piutang_pinjaman")!;
  const pendapatanBunga = accountIdByKey.get("pendapatan_bunga")!;
  const pendapatanLain = accountIdByKey.get("pendapatan_lain")!;
  const equityOrLiabilityBySavingType: Record<"POKOK" | "WAJIB" | "SUKARELA", string> = {
    POKOK: accountIdByKey.get("simpanan_pokok")!,
    WAJIB: accountIdByKey.get("simpanan_wajib")!,
    SUKARELA: accountIdByKey.get("simpanan_sukarela")!
  };

  async function upsertMapping(
    key: string,
    sourceType: MappingSourceType,
    sourceId: string,
    transactionKind: MappingTransactionKind,
    debitAccountId: string,
    creditAccountId: string
  ) {
    const id = `${tenantId}_map_${key}`;
    await prisma.accountMapping.upsert({
      where: { id },
      update: { debitAccountId, creditAccountId },
      create: { id, tenantId, sourceType, sourceId, transactionKind, debitAccountId, creditAccountId }
    });
  }

  // Setoran/penarikan per jenis simpanan — Pokok/Wajib -> Ekuitas, Sukarela -> Kewajiban
  // (conventional koperasi treatment, Design Spec §4/§2).
  for (const [type, savingConfigId] of Object.entries(savingConfigIds) as Array<
    [keyof typeof savingConfigIds, string]
  >) {
    const equityOrLiability = equityOrLiabilityBySavingType[type];
    await upsertMapping(`${type}_deposit`, "SAVING_CONFIG", savingConfigId, "DEPOSIT", kas, equityOrLiability);
    await upsertMapping(`${type}_withdrawal`, "SAVING_CONFIG", savingConfigId, "WITHDRAWAL", equityOrLiability, kas);
  }

  // Pencairan/pembayaran per jenis pembiayaan — every loan config posts through
  // the same Kas/Piutang/Pendapatan accounts.
  for (const loanConfigId of loanConfigIds) {
    await upsertMapping(`${loanConfigId}_disbursement`, "LOAN_CONFIG", loanConfigId, "DISBURSEMENT", piutang, kas);
    await upsertMapping(`${loanConfigId}_principal`, "LOAN_CONFIG", loanConfigId, "PAYMENT_PRINCIPAL", kas, piutang);
    await upsertMapping(`${loanConfigId}_interest`, "LOAN_CONFIG", loanConfigId, "PAYMENT_INTEREST", kas, pendapatanBunga);
    await upsertMapping(`${loanConfigId}_penalty`, "LOAN_CONFIG", loanConfigId, "PAYMENT_PENALTY", kas, pendapatanLain);
  }

  // Initial paid-in capital — without this, loan disbursements (funded from
  // Kas) outstrip what member savings deposits alone provide, and Kas goes
  // negative on the Neraca. Dated well before any seeded saving/loan activity
  // so it's already part of history for every report period.
  const cadangan = accountIdByKey.get("cadangan")!;
  await prisma.journalEntry.upsert({
    where: { id: `${tenantId}_je_modal_awal` },
    update: {},
    create: {
      id: `${tenantId}_je_modal_awal`,
      tenantId,
      entryDate: new Date("2025-01-01"),
      sourceType: "MANUAL",
      description: "Setoran modal awal pendirian koperasi",
      status: "POSTED",
      lines: {
        create: [
          { tenantId, accountId: kas, debit: 10_000_000, credit: 0 },
          { tenantId, accountId: cadangan, debit: 0, credit: 10_000_000 }
        ]
      }
    }
  });

  // SHU allocation used by the "Pembagian SHU" regulatory report — see
  // Docs/specs/2026-07-22-pelaporan-regulasi-design.md §6.4.
  await prisma.shuDistributionConfig.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, jasaSimpananPercent: 25, jasaPinjamanPercent: 25, cadanganPercent: 40, lainnyaPercent: 10 }
  });

  // CALK narrative sections — edited once, reused every period (see
  // modules/reports/regulatory-service.ts getCalk()).
  for (const section of Object.keys(CALK_NARRATIVE) as CalkSection[]) {
    await prisma.calkNarrative.upsert({
      where: { tenantId_section: { tenantId, section } },
      update: {},
      create: { tenantId, section, content: CALK_NARRATIVE[section] }
    });
  }
}

async function main() {
  console.log("Starting seed...");

  // 0. Subscription package with accounting + whitelabel entitlements (Phase 2 —
  // no route reads this yet, but seeding it now avoids a second migration later).
  const fullPackage = await prisma.subscriptionPackage.upsert({
    where: { id: "pkg_lengkap_demo" },
    update: {},
    create: {
      id: "pkg_lengkap_demo",
      name: "Paket Lengkap (Demo)",
      price: 500000,
      modules: ["accounting"],
      maxUsers: 20,
      maxMembers: 500,
      maxSavingConfigs: null,
      whitelabelEnabled: true,
      isActive: true
    }
  });
  console.log("Subscription package created:", fullPackage.name);

  // 1. Demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: { packageId: fullPackage.id },
    create: {
      name: "Koperasi Demo Sejahtera",
      slug: "demo",
      address: "Jl. Merdeka No. 1, Jakarta Pusat, DKI Jakarta",
      registrationNo: "KOP/001/DEMO/2020",
      type: TenantType.KONVENSIONAL,
      cooperativeType: "Koperasi Simpan Pinjam",
      packageId: fullPackage.id,
      isActive: true
    }
  });
  console.log("Tenant created:", tenant.slug);

  // Every tenant has >=1 CooperativeUnit (CLAUDE.md rule 2b). No unit-picker UI
  // exists in Phase 1 — Saving/Loan resolve this one unit server-side.
  const demoUnit = await prisma.cooperativeUnit.upsert({
    where: { id: `${tenant.id}_ksp` },
    update: {},
    create: { id: `${tenant.id}_ksp`, tenantId: tenant.id, type: "KSP", name: "Simpan Pinjam", isActive: true }
  });
  console.log("Cooperative unit created:", demoUnit.name);

  // 2. Default roles
  const defaultPermissions = {
    dashboard: { read: true },
    members: { create: true, read: true, update: true, delete: true },
    savings: { create: true, read: true, update: true, delete: true },
    loans: { create: true, read: true, update: true, delete: true },
    reports: { read: true, export: true, update: true },
    config: { read: true, update: true },
    users: { create: true, read: true, update: true, delete: true },
    roles: { create: true, read: true, update: true, delete: true },
    accounting: { create: true, read: true, update: true, delete: true }
  };

  const superAdminRole = await prisma.role.upsert({
    where: { id: `${tenant.id}_super_admin` },
    update: { permissions: defaultPermissions },
    create: { id: `${tenant.id}_super_admin`, tenantId: tenant.id, name: "Super Admin", permissions: defaultPermissions }
  });

  const managerPermissions = {
    ...defaultPermissions,
    config: { read: true, update: false },
    users: { create: false, read: true, update: false, delete: false },
    roles: { create: false, read: true, update: false, delete: false },
    accounting: { create: false, read: false, update: false, delete: false }
  };
  await prisma.role.upsert({
    where: { id: `${tenant.id}_manager` },
    update: { permissions: managerPermissions },
    create: { id: `${tenant.id}_manager`, tenantId: tenant.id, name: "Manager", permissions: managerPermissions }
  });

  const tellerPermissions = {
    dashboard: { read: true },
    members: { create: false, read: true, update: false, delete: false },
    savings: { create: true, read: true, update: true, delete: false },
    loans: { create: false, read: true, update: true, delete: false },
    reports: { read: false, export: false, update: false },
    config: { read: false, update: false },
    users: { create: false, read: false, update: false, delete: false },
    roles: { create: false, read: false, update: false, delete: false },
    accounting: { create: false, read: false, update: false, delete: false }
  };
  await prisma.role.upsert({
    where: { id: `${tenant.id}_teller` },
    update: { permissions: tellerPermissions },
    create: { id: `${tenant.id}_teller`, tenantId: tenant.id, name: "Teller", permissions: tellerPermissions }
  });

  const viewerPermissions = {
    dashboard: { read: true },
    members: { create: false, read: true, update: false, delete: false },
    savings: { create: false, read: true, update: false, delete: false },
    loans: { create: false, read: true, update: false, delete: false },
    reports: { read: true, export: false, update: false },
    config: { read: false, update: false },
    users: { create: false, read: false, update: false, delete: false },
    roles: { create: false, read: false, update: false, delete: false },
    accounting: { create: false, read: false, update: false, delete: false }
  };
  await prisma.role.upsert({
    where: { id: `${tenant.id}_viewer` },
    update: { permissions: viewerPermissions },
    create: { id: `${tenant.id}_viewer`, tenantId: tenant.id, name: "Viewer", permissions: viewerPermissions }
  });

  console.log("Roles created");

  // 3. Admin user
  const hashedPassword = await bcrypt.hash("Admin123!", 12);
  const adminUser = await prisma.user.upsert({
    where: { id: `${tenant.id}_admin` },
    update: {},
    create: {
      id: `${tenant.id}_admin`,
      tenantId: tenant.id,
      roleId: superAdminRole.id,
      email: "admin@demo.com",
      passwordHash: hashedPassword,
      name: "Administrator Demo",
      isActive: true
    }
  });
  console.log("Admin user created:", adminUser.email);

  // 4. Saving configs
  await prisma.savingConfig.upsert({
    where: { id: `${tenant.id}_pokok` },
    update: {},
    create: {
      id: `${tenant.id}_pokok`,
      tenantId: tenant.id,
      name: "Simpanan Pokok",
      type: SavingType.POKOK,
      rateType: RateType.BUNGA,
      rate: 0,
      periodUnit: "MONTHLY",
      isActive: true
    }
  });
  await prisma.savingConfig.upsert({
    where: { id: `${tenant.id}_wajib` },
    update: {},
    create: {
      id: `${tenant.id}_wajib`,
      tenantId: tenant.id,
      name: "Simpanan Wajib",
      type: SavingType.WAJIB,
      rateType: RateType.BUNGA,
      rate: 2.5,
      periodUnit: "YEARLY",
      isActive: true
    }
  });
  await prisma.savingConfig.upsert({
    where: { id: `${tenant.id}_sukarela` },
    update: {},
    create: {
      id: `${tenant.id}_sukarela`,
      tenantId: tenant.id,
      name: "Simpanan Sukarela",
      type: SavingType.SUKARELA,
      rateType: RateType.BUNGA,
      rate: 3.0,
      periodUnit: "YEARLY",
      isActive: true
    }
  });
  console.log("Saving configs created");

  // 5. Loan configs
  await prisma.loanConfig.upsert({
    where: { id: `${tenant.id}_kur` },
    update: {},
    create: {
      id: `${tenant.id}_kur`,
      tenantId: tenant.id,
      name: "KUR Mikro",
      type: LoanType.KONVENSIONAL,
      rateType: RateType.BUNGA,
      rate: 12.0,
      maxTermMonths: 36,
      isActive: true
    }
  });
  await prisma.loanConfig.upsert({
    where: { id: `${tenant.id}_umum` },
    update: {},
    create: {
      id: `${tenant.id}_umum`,
      tenantId: tenant.id,
      name: "Pinjaman Umum",
      type: LoanType.KONVENSIONAL,
      rateType: RateType.BUNGA,
      rate: 18.0,
      maxTermMonths: 24,
      isActive: true
    }
  });
  console.log("Loan configs created");

  // 5b. Accounting: Chart of Accounts + mappings + SHU allocation + CALK narratives
  // — must run before seed-demo-transactions.mjs so its API calls post real
  // journal entries instead of UNPOSTED_MISSING_MAPPING.
  await seedAccounting(
    tenant.id,
    { POKOK: `${tenant.id}_pokok`, WAJIB: `${tenant.id}_wajib`, SUKARELA: `${tenant.id}_sukarela` },
    [`${tenant.id}_kur`, `${tenant.id}_umum`]
  );
  console.log("Chart of Accounts, mappings, SHU config, and CALK narratives created");

  // 6. 10 sample members (structural only — no Saving/Loan records here; those
  // are created through the real API by seed-demo-transactions.mjs so the
  // journal posting engine + KOL recalculation run exactly as in normal use).
  const members = [
    { fullName: "Budi Santoso", nik: "3171234567890001", birthPlace: "Jakarta", birthDate: new Date("1985-03-15"), occupation: "Pedagang", address: "Jl. Kebon Jeruk No. 5, Jakarta Barat" },
    { fullName: "Siti Rahayu", nik: "3171234567890002", birthPlace: "Bandung", birthDate: new Date("1990-07-22"), occupation: "Guru", address: "Jl. Raya Bogor No. 12, Jakarta Timur" },
    { fullName: "Ahmad Fauzi", nik: "3171234567890003", birthPlace: "Surabaya", birthDate: new Date("1978-11-08"), occupation: "Petani", address: "Jl. Mangga Dua No. 3, Jakarta Utara" },
    { fullName: "Dewi Lestari", nik: "3171234567890004", birthPlace: "Semarang", birthDate: new Date("1988-02-14"), occupation: "Wiraswasta", address: "Jl. Sudirman No. 45, Jakarta Selatan" },
    { fullName: "Eko Prasetyo", nik: "3171234567890005", birthPlace: "Yogyakarta", birthDate: new Date("1982-09-30"), occupation: "Karyawan Swasta", address: "Jl. Gatot Subroto No. 21, Jakarta Selatan" },
    { fullName: "Fitriani", nik: "3171234567890006", birthPlace: "Medan", birthDate: new Date("1993-05-17"), occupation: "Pedagang", address: "Jl. Pasar Minggu No. 9, Jakarta Selatan" },
    { fullName: "Gunawan Wijaya", nik: "3171234567890007", birthPlace: "Malang", birthDate: new Date("1975-12-01"), occupation: "Wiraswasta", address: "Jl. Fatmawati No. 33, Jakarta Selatan" },
    { fullName: "Hendra Kusuma", nik: "3171234567890008", birthPlace: "Palembang", birthDate: new Date("1991-04-25"), occupation: "Karyawan Swasta", address: "Jl. Cempaka Putih No. 7, Jakarta Pusat" },
    { fullName: "Indah Permata", nik: "3171234567890009", birthPlace: "Makassar", birthDate: new Date("1987-08-19"), occupation: "Guru", address: "Jl. Kelapa Gading No. 15, Jakarta Utara" },
    { fullName: "Rahmat Hidayat", nik: "3171234567890010", birthPlace: "Padang", birthDate: new Date("1980-01-10"), occupation: "Petani", address: "Jl. Tebet Raya No. 27, Jakarta Selatan" }
  ];

  for (const [index, m] of members.entries()) {
    const seq = String(index + 1).padStart(4, "0");
    const memberId = `KOP-DEMO-202606-${seq}`;
    const accountNumber = `ACC-${3847291000 + index}`;

    const member = await prisma.member.upsert({
      where: { memberId },
      update: {},
      create: { tenantId: tenant.id, memberId, accountNumber, ...m, isActive: true }
    });

    // Auto-enrolled into the tenant's sole unit, matching what the real
    // Members API does on creation (see modules/members/service.ts).
    await prisma.unitMembership.upsert({
      where: { memberId_unitId: { memberId: member.id, unitId: demoUnit.id } },
      update: {},
      create: { memberId: member.id, unitId: demoUnit.id }
    });
  }
  console.log("10 sample members created (savings/loans populated by the demo-transactions script)");

  // 7. Platform admin users
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "superadmin@siskop.com" } },
    update: {},
    create: {
      id: "platform_admin",
      tenantId: tenant.id,
      roleId: superAdminRole.id,
      email: "superadmin@siskop.com",
      passwordHash: await bcrypt.hash("SuperAdmin123!", 12),
      name: "Platform Administrator",
      isPlatformAdmin: true,
      isActive: true
    }
  });
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "ops@siskop.com" } },
    update: {},
    create: {
      id: "platform_admin_ops",
      tenantId: tenant.id,
      roleId: superAdminRole.id,
      email: "ops@siskop.com",
      passwordHash: await bcrypt.hash("Ops123456!", 12),
      name: "Operator Platform",
      isPlatformAdmin: true,
      isActive: true
    }
  });
  console.log("Platform admin users created");

  // 8. Second tenant (syariah, no subscription package) — a tenant WITHOUT the
  // accounting entitlement, for Phase 2 entitlement-gating work later.
  const barokah = await prisma.tenant.upsert({
    where: { slug: "barokah" },
    update: {},
    create: {
      name: "Koperasi Syariah Barokah",
      slug: "barokah",
      address: "Jl. Asia Afrika No. 8, Bandung, Jawa Barat",
      registrationNo: "KOP/002/BRK/2021",
      type: TenantType.SYARIAH,
      cooperativeType: "Koperasi Simpan Pinjam Syariah",
      isActive: true
    }
  });

  const barokahUnit = await prisma.cooperativeUnit.upsert({
    where: { id: `${barokah.id}_ksp` },
    update: {},
    create: { id: `${barokah.id}_ksp`, tenantId: barokah.id, type: "KSP", name: "Simpan Pinjam Syariah", isActive: true }
  });

  const barokahSuperAdminRole = await prisma.role.upsert({
    where: { id: `${barokah.id}_super_admin` },
    update: { permissions: defaultPermissions },
    create: { id: `${barokah.id}_super_admin`, tenantId: barokah.id, name: "Super Admin", permissions: defaultPermissions }
  });

  await prisma.user.upsert({
    where: { id: `${barokah.id}_admin` },
    update: {},
    create: {
      id: `${barokah.id}_admin`,
      tenantId: barokah.id,
      roleId: barokahSuperAdminRole.id,
      email: "admin@barokah.com",
      passwordHash: await bcrypt.hash("Admin123!", 12),
      name: "Administrator Barokah",
      isActive: true
    }
  });

  await prisma.savingConfig.upsert({
    where: { id: `${barokah.id}_pokok` },
    update: {},
    create: {
      id: `${barokah.id}_pokok`,
      tenantId: barokah.id,
      name: "Simpanan Pokok",
      type: SavingType.POKOK,
      rateType: RateType.BAGI_HASIL,
      rate: 0,
      periodUnit: "MONTHLY",
      isActive: true
    }
  });
  await prisma.savingConfig.upsert({
    where: { id: `${barokah.id}_wajib` },
    update: {},
    create: {
      id: `${barokah.id}_wajib`,
      tenantId: barokah.id,
      name: "Simpanan Wajib",
      type: SavingType.WAJIB,
      rateType: RateType.BAGI_HASIL,
      rate: 2.0,
      periodUnit: "YEARLY",
      isActive: true
    }
  });
  await prisma.savingConfig.upsert({
    where: { id: `${barokah.id}_sukarela` },
    update: {},
    create: {
      id: `${barokah.id}_sukarela`,
      tenantId: barokah.id,
      name: "Simpanan Sukarela",
      type: SavingType.SUKARELA,
      rateType: RateType.BAGI_HASIL,
      rate: 2.5,
      periodUnit: "YEARLY",
      isActive: true
    }
  });
  console.log("Saving configs created (Barokah)");

  // Syariah financing configs (Barokah's equivalent of the demo tenant's loan
  // configs) — flat margin, not annuitas (see lib/loan-calc.ts).
  await prisma.loanConfig.upsert({
    where: { id: `${barokah.id}_murabahah` },
    update: {},
    create: {
      id: `${barokah.id}_murabahah`,
      tenantId: barokah.id,
      name: "Pembiayaan Murabahah",
      type: LoanType.SYARIAH,
      rateType: RateType.MARGIN,
      rate: 10.0,
      maxTermMonths: 24,
      isActive: true
    }
  });
  await prisma.loanConfig.upsert({
    where: { id: `${barokah.id}_modal_usaha` },
    update: {},
    create: {
      id: `${barokah.id}_modal_usaha`,
      tenantId: barokah.id,
      name: "Pembiayaan Modal Usaha",
      type: LoanType.SYARIAH,
      rateType: RateType.MARGIN,
      rate: 8.0,
      maxTermMonths: 18,
      isActive: true
    }
  });
  console.log("Loan configs created (Barokah)");

  await seedAccounting(
    barokah.id,
    { POKOK: `${barokah.id}_pokok`, WAJIB: `${barokah.id}_wajib`, SUKARELA: `${barokah.id}_sukarela` },
    [`${barokah.id}_murabahah`, `${barokah.id}_modal_usaha`]
  );
  console.log("Chart of Accounts, mappings, SHU config, and CALK narratives created (Barokah)");

  // 10 sample members for Barokah, mirroring the demo tenant's structural-only
  // approach — savings/loans populated via the real API by
  // seed-demo-transactions.mjs so journal posting + KOL recalculation run.
  const barokahMembers = [
    { fullName: "Rina Amalia", nik: "3273234567890001", birthPlace: "Bandung", birthDate: new Date("1992-06-12"), occupation: "Wiraswasta", address: "Jl. Braga No. 10, Bandung" },
    { fullName: "Yusuf Abdullah", nik: "3273234567890002", birthPlace: "Bandung", birthDate: new Date("1984-01-20"), occupation: "Pedagang", address: "Jl. Asia Afrika No. 21, Bandung" },
    { fullName: "Siti Maimunah", nik: "3273234567890003", birthPlace: "Cimahi", birthDate: new Date("1990-10-05"), occupation: "Guru Ngaji", address: "Jl. Cihampelas No. 44, Bandung" },
    { fullName: "Asep Sudrajat", nik: "3273234567890004", birthPlace: "Garut", birthDate: new Date("1979-04-18"), occupation: "Petani", address: "Jl. Dago No. 67, Bandung" },
    { fullName: "Neneng Kartika", nik: "3273234567890005", birthPlace: "Bandung", birthDate: new Date("1995-08-27"), occupation: "Wiraswasta", address: "Jl. Kopo No. 12, Bandung" },
    { fullName: "Dedi Supriadi", nik: "3273234567890006", birthPlace: "Sumedang", birthDate: new Date("1983-12-02"), occupation: "Karyawan Swasta", address: "Jl. Buah Batu No. 88, Bandung" },
    { fullName: "Euis Sumiati", nik: "3273234567890007", birthPlace: "Bandung", birthDate: new Date("1988-03-09"), occupation: "Pedagang", address: "Jl. Sukajadi No. 5, Bandung" },
    { fullName: "Iwan Setiawan", nik: "3273234567890008", birthPlace: "Cianjur", birthDate: new Date("1981-07-14"), occupation: "Wiraswasta", address: "Jl. Pasteur No. 30, Bandung" },
    { fullName: "Lilis Suryani", nik: "3273234567890009", birthPlace: "Bandung", birthDate: new Date("1993-11-23"), occupation: "Penjahit", address: "Jl. Riau No. 19, Bandung" },
    { fullName: "Wawan Gunawan", nik: "3273234567890010", birthPlace: "Tasikmalaya", birthDate: new Date("1977-05-30"), occupation: "Petani", address: "Jl. Setiabudi No. 56, Bandung" }
  ];

  for (const [index, m] of barokahMembers.entries()) {
    const seq = String(index + 1).padStart(4, "0");
    const memberId = `KOP-BRK-202606-${seq}`;
    const accountNumber = `ACC-${9284710001 + index}`;

    const member = await prisma.member.upsert({
      where: { memberId },
      update: {},
      create: { tenantId: barokah.id, memberId, accountNumber, ...m, isActive: true }
    });

    await prisma.unitMembership.upsert({
      where: { memberId_unitId: { memberId: member.id, unitId: barokahUnit.id } },
      update: {},
      create: { memberId: member.id, unitId: barokahUnit.id }
    });
  }
  console.log("10 sample members created for Barokah (savings/loans populated by the demo-transactions script)");
  console.log("Second tenant (Koperasi Syariah Barokah, no accounting package) created");

  // 9. Platform-admin notifications — one of each NotificationType (Phase 2 —
  // no notification-center UI yet, but the data is ready for it).
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  await prisma.notification.createMany({
    data: [
      {
        type: NotificationType.TENANT_REGISTERED,
        title: "Koperasi baru terdaftar",
        message: "Koperasi Syariah Barokah baru saja mendaftar ke platform",
        relatedTenantId: barokah.id,
        createdAt: daysAgo(3)
      },
      {
        type: NotificationType.PACKAGE_CHANGED,
        title: "Paket langganan diperbarui",
        message: "Koperasi Demo Sejahtera beralih ke Paket Lengkap (Demo) dengan modul akuntansi",
        relatedTenantId: tenant.id,
        createdAt: daysAgo(2)
      },
      {
        type: NotificationType.BILLING_BLOCKED,
        title: "Tagihan belum dibayar",
        message: "Koperasi Syariah Barokah memiliki tagihan yang telah jatuh tempo",
        relatedTenantId: barokah.id,
        createdAt: daysAgo(1)
      },
      {
        type: NotificationType.AUDIT_THRESHOLD_EXCEEDED,
        title: "Ambang batas audit wajib tercapai",
        message: "Modal disetor Koperasi Demo Sejahtera telah mencapai Rp5.000.000.000 — audit wajib sesuai Permenkop UKM No. 2/2024 Pasal 12",
        relatedTenantId: tenant.id,
        createdAt: now
      }
    ]
  });
  console.log("Sample notifications created");

  console.log("");
  console.log("Structural seed completed!");
  console.log("");
  console.log("Next: run the transactional demo-data script while the backend dev server is");
  console.log("running (pnpm run dev), so savings/loans post through the real API and its");
  console.log("journal-posting/KOL-recalculation logic:");
  console.log("  npx tsx prisma/seed-demo-transactions.mjs");
  console.log("");
  console.log("Login credentials:");
  console.log("  Tenant (demo):    http://demo.localhost:3000");
  console.log("    Email:    admin@demo.com");
  console.log("    Password: Admin123!");
  console.log("  Tenant (barokah): http://barokah.localhost:3000");
  console.log("    Email:    admin@barokah.com");
  console.log("    Password: Admin123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
