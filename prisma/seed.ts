import { PrismaClient, TenantType, SavingType, RateType, LoanType, NotificationType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // 0. Subscription package with accounting + whitelabel entitlements, assigned to the demo tenant
  const fullPackage = await prisma.subscriptionPackage.upsert({
    where: { id: 'pkg_lengkap_demo' },
    update: {},
    create: {
      id: 'pkg_lengkap_demo',
      name: 'Paket Lengkap (Demo)',
      price: 500000,
      modules: ['accounting'],
      maxUsers: 20,
      maxMembers: 500,
      maxSavingConfigs: null,
      whitelabelEnabled: true,
      isActive: true,
    },
  });
  console.log('✅ Subscription package created:', fullPackage.name);

  // 1. Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: { packageId: fullPackage.id },
    create: {
      name: 'Koperasi Demo Sejahtera',
      slug: 'demo',
      address: 'Jl. Merdeka No. 1, Jakarta Pusat, DKI Jakarta',
      registrationNo: 'KOP/001/DEMO/2020',
      type: TenantType.KONVENSIONAL,
      cooperativeType: 'Koperasi Simpan Pinjam',
      packageId: fullPackage.id,
      isActive: true,
    },
  });
  console.log('✅ Tenant created:', tenant.slug);

  // 2. Create default roles
  const defaultPermissions = {
    dashboard: { read: true },
    members: { create: true, read: true, update: true, delete: true },
    savings: { create: true, read: true, update: true, delete: true },
    loans: { create: true, read: true, update: true, delete: true },
    reports: { read: true, export: true, update: true },
    config: { read: true, update: true },
    users: { create: true, read: true, update: true, delete: true },
    roles: { create: true, read: true, update: true, delete: true },
    accounting: { create: true, read: true, update: true, delete: true },
  };

  const superAdminRole = await prisma.role.upsert({
    where: { id: `${tenant.id}_super_admin` },
    update: { permissions: defaultPermissions },
    create: {
      id: `${tenant.id}_super_admin`,
      tenantId: tenant.id,
      name: 'Super Admin',
      permissions: defaultPermissions,
    },
  });

  const managerPermissions = {
    ...defaultPermissions,
    config: { read: true, update: false },
    users: { create: false, read: true, update: false, delete: false },
    roles: { create: false, read: true, update: false, delete: false },
    accounting: { create: false, read: false, update: false, delete: false },
  };
  const managerRole = await prisma.role.upsert({
    where: { id: `${tenant.id}_manager` },
    update: { permissions: managerPermissions },
    create: {
      id: `${tenant.id}_manager`,
      tenantId: tenant.id,
      name: 'Manager',
      permissions: managerPermissions,
    },
  });

  // Suppress unused warning for managerRole (used only as seed data)
  void managerRole;

  const tellerPermissions = {
    dashboard: { read: true },
    members: { create: false, read: true, update: false, delete: false },
    savings: { create: true, read: true, update: true, delete: false },
    loans: { create: false, read: true, update: true, delete: false },
    reports: { read: false, export: false, update: false },
    config: { read: false, update: false },
    users: { create: false, read: false, update: false, delete: false },
    roles: { create: false, read: false, update: false, delete: false },
    accounting: { create: false, read: false, update: false, delete: false },
  };
  await prisma.role.upsert({
    where: { id: `${tenant.id}_teller` },
    update: { permissions: tellerPermissions },
    create: {
      id: `${tenant.id}_teller`,
      tenantId: tenant.id,
      name: 'Teller',
      permissions: tellerPermissions,
    },
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
    accounting: { create: false, read: false, update: false, delete: false },
  };
  await prisma.role.upsert({
    where: { id: `${tenant.id}_viewer` },
    update: { permissions: viewerPermissions },
    create: {
      id: `${tenant.id}_viewer`,
      tenantId: tenant.id,
      name: 'Viewer',
      permissions: viewerPermissions,
    },
  });

  console.log('✅ Roles created');

  // 3. Create admin user
  const hashedPassword = await bcrypt.hash('Admin123!', 12);
  const adminUser = await prisma.user.upsert({
    where: { id: `${tenant.id}_admin` },
    update: {},
    create: {
      id: `${tenant.id}_admin`,
      tenantId: tenant.id,
      roleId: superAdminRole.id,
      email: 'admin@demo.com',
      passwordHash: hashedPassword,
      name: 'Administrator Demo',
      isActive: true,
    },
  });
  console.log('✅ Admin user created:', adminUser.email);

  // 4. Create saving configs
  const simpananPokok = await prisma.savingConfig.upsert({
    where: { id: `${tenant.id}_pokok` },
    update: {},
    create: {
      id: `${tenant.id}_pokok`,
      tenantId: tenant.id,
      name: 'Simpanan Pokok',
      type: SavingType.POKOK,
      rateType: RateType.BUNGA,
      rate: 0,
      periodUnit: 'MONTHLY',
      isActive: true,
    },
  });

  const simpananWajib = await prisma.savingConfig.upsert({
    where: { id: `${tenant.id}_wajib` },
    update: {},
    create: {
      id: `${tenant.id}_wajib`,
      tenantId: tenant.id,
      name: 'Simpanan Wajib',
      type: SavingType.WAJIB,
      rateType: RateType.BUNGA,
      rate: 2.5,
      periodUnit: 'YEARLY',
      isActive: true,
    },
  });

  const simpananSukarela = await prisma.savingConfig.upsert({
    where: { id: `${tenant.id}_sukarela` },
    update: {},
    create: {
      id: `${tenant.id}_sukarela`,
      tenantId: tenant.id,
      name: 'Simpanan Sukarela',
      type: SavingType.SUKARELA,
      rateType: RateType.BUNGA,
      rate: 3.0,
      periodUnit: 'YEARLY',
      isActive: true,
    },
  });

  void simpananPokok;
  void simpananWajib;
  void simpananSukarela;

  console.log('✅ Saving configs created');

  // 5. Create loan configs
  await prisma.loanConfig.upsert({
    where: { id: `${tenant.id}_kur` },
    update: {},
    create: {
      id: `${tenant.id}_kur`,
      tenantId: tenant.id,
      name: 'KUR Mikro',
      type: LoanType.KONVENSIONAL,
      rateType: RateType.BUNGA,
      rate: 12.0,
      maxTermMonths: 36,
      isActive: true,
    },
  });

  await prisma.loanConfig.upsert({
    where: { id: `${tenant.id}_umum` },
    update: {},
    create: {
      id: `${tenant.id}_umum`,
      tenantId: tenant.id,
      name: 'Pinjaman Umum',
      type: LoanType.KONVENSIONAL,
      rateType: RateType.BUNGA,
      rate: 18.0,
      maxTermMonths: 24,
      isActive: true,
    },
  });

  console.log('✅ Loan configs created');

  // 6. Create 10 sample members (structural only — no Saving/Loan records here;
  // those are created through the real API by scripts/seed-demo-transactions.mjs
  // so the journal posting engine + KOL recalculation run exactly as in normal use).
  const members = [
    {
      fullName: 'Budi Santoso',
      nik: '3171234567890001',
      birthPlace: 'Jakarta',
      birthDate: new Date('1985-03-15'),
      occupation: 'Pedagang',
      address: 'Jl. Kebon Jeruk No. 5, Jakarta Barat',
    },
    {
      fullName: 'Siti Rahayu',
      nik: '3171234567890002',
      birthPlace: 'Bandung',
      birthDate: new Date('1990-07-22'),
      occupation: 'Guru',
      address: 'Jl. Raya Bogor No. 12, Jakarta Timur',
    },
    {
      fullName: 'Ahmad Fauzi',
      nik: '3171234567890003',
      birthPlace: 'Surabaya',
      birthDate: new Date('1978-11-08'),
      occupation: 'Petani',
      address: 'Jl. Mangga Dua No. 3, Jakarta Utara',
    },
    {
      fullName: 'Dewi Lestari',
      nik: '3171234567890004',
      birthPlace: 'Semarang',
      birthDate: new Date('1988-02-14'),
      occupation: 'Wiraswasta',
      address: 'Jl. Sudirman No. 45, Jakarta Selatan',
    },
    {
      fullName: 'Eko Prasetyo',
      nik: '3171234567890005',
      birthPlace: 'Yogyakarta',
      birthDate: new Date('1982-09-30'),
      occupation: 'Karyawan Swasta',
      address: 'Jl. Gatot Subroto No. 21, Jakarta Selatan',
    },
    {
      fullName: 'Fitriani',
      nik: '3171234567890006',
      birthPlace: 'Medan',
      birthDate: new Date('1993-05-17'),
      occupation: 'Pedagang',
      address: 'Jl. Pasar Minggu No. 9, Jakarta Selatan',
    },
    {
      fullName: 'Gunawan Wijaya',
      nik: '3171234567890007',
      birthPlace: 'Malang',
      birthDate: new Date('1975-12-01'),
      occupation: 'Wiraswasta',
      address: 'Jl. Fatmawati No. 33, Jakarta Selatan',
    },
    {
      fullName: 'Hendra Kusuma',
      nik: '3171234567890008',
      birthPlace: 'Palembang',
      birthDate: new Date('1991-04-25'),
      occupation: 'Karyawan Swasta',
      address: 'Jl. Cempaka Putih No. 7, Jakarta Pusat',
    },
    {
      fullName: 'Indah Permata',
      nik: '3171234567890009',
      birthPlace: 'Makassar',
      birthDate: new Date('1987-08-19'),
      occupation: 'Guru',
      address: 'Jl. Kelapa Gading No. 15, Jakarta Utara',
    },
    {
      fullName: 'Rahmat Hidayat',
      nik: '3171234567890010',
      birthPlace: 'Padang',
      birthDate: new Date('1980-01-10'),
      occupation: 'Petani',
      address: 'Jl. Tebet Raya No. 27, Jakarta Selatan',
    },
  ];

  for (const [index, m] of members.entries()) {
    const seq = String(index + 1).padStart(4, '0');
    const memberId = `KOP-DEMO-202606-${seq}`;
    const accountNumber = `ACC-${3847291000 + index}`;

    await prisma.member.upsert({
      where: { memberId },
      update: {},
      create: {
        tenantId: tenant.id,
        memberId,
        accountNumber,
        ...m,
        isActive: true,
      },
    });
  }

  console.log('✅ 10 sample members created (savings/loans populated by the demo-transactions script)');

  // 7. Create platform admin users
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'superadmin@siskop.com' } },
    update: {},
    create: {
      id: 'platform_admin',
      tenantId: tenant.id,
      roleId: superAdminRole.id,
      email: 'superadmin@siskop.com',
      passwordHash: await bcrypt.hash('SuperAdmin123!', 12),
      name: 'Platform Administrator',
      isPlatformAdmin: true,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'ops@siskop.com' } },
    update: {},
    create: {
      id: 'platform_admin_ops',
      tenantId: tenant.id,
      roleId: superAdminRole.id,
      email: 'ops@siskop.com',
      passwordHash: await bcrypt.hash('Ops123456!', 12),
      name: 'Operator Platform',
      isPlatformAdmin: true,
      isActive: true,
    },
  });
  console.log('✅ Platform admin users created');

  // 8. Second tenant (syariah, no subscription package) — gives the platform admin
  // tenant list a second row and demonstrates a tenant WITHOUT the accounting
  // entitlement (Konfigurasi Akun / Laporan Regulasi should show FEATURE_NOT_ENTITLED).
  const barokah = await prisma.tenant.upsert({
    where: { slug: 'barokah' },
    update: {},
    create: {
      name: 'Koperasi Syariah Barokah',
      slug: 'barokah',
      address: 'Jl. Asia Afrika No. 8, Bandung, Jawa Barat',
      registrationNo: 'KOP/002/BRK/2021',
      type: TenantType.SYARIAH,
      cooperativeType: 'Koperasi Simpan Pinjam Syariah',
      isActive: true,
    },
  });

  const barokahSuperAdminRole = await prisma.role.upsert({
    where: { id: `${barokah.id}_super_admin` },
    update: { permissions: defaultPermissions },
    create: {
      id: `${barokah.id}_super_admin`,
      tenantId: barokah.id,
      name: 'Super Admin',
      permissions: defaultPermissions,
    },
  });

  await prisma.user.upsert({
    where: { id: `${barokah.id}_admin` },
    update: {},
    create: {
      id: `${barokah.id}_admin`,
      tenantId: barokah.id,
      roleId: barokahSuperAdminRole.id,
      email: 'admin@barokah.com',
      passwordHash: await bcrypt.hash('Admin123!', 12),
      name: 'Administrator Barokah',
      isActive: true,
    },
  });

  const barokahPokok = await prisma.savingConfig.upsert({
    where: { id: `${barokah.id}_pokok` },
    update: {},
    create: {
      id: `${barokah.id}_pokok`,
      tenantId: barokah.id,
      name: 'Simpanan Pokok',
      type: SavingType.POKOK,
      rateType: RateType.BAGI_HASIL,
      rate: 0,
      periodUnit: 'MONTHLY',
      isActive: true,
    },
  });
  await prisma.savingConfig.upsert({
    where: { id: `${barokah.id}_wajib` },
    update: {},
    create: {
      id: `${barokah.id}_wajib`,
      tenantId: barokah.id,
      name: 'Simpanan Wajib',
      type: SavingType.WAJIB,
      rateType: RateType.BAGI_HASIL,
      rate: 2.0,
      periodUnit: 'YEARLY',
      isActive: true,
    },
  });

  const rina = await prisma.member.upsert({
    where: { memberId: 'KOP-BRK-202606-0001' },
    update: {},
    create: {
      tenantId: barokah.id,
      memberId: 'KOP-BRK-202606-0001',
      accountNumber: 'ACC-9284710001',
      fullName: 'Rina Amalia',
      nik: '3273234567890001',
      birthPlace: 'Bandung',
      birthDate: new Date('1992-06-12'),
      occupation: 'Wiraswasta',
      address: 'Jl. Braga No. 10, Bandung',
      isActive: true,
    },
  });
  await prisma.saving.upsert({
    where: { id: `saving_pokok_${rina.id}` },
    update: {},
    create: {
      id: `saving_pokok_${rina.id}`,
      tenantId: barokah.id,
      memberId: rina.id,
      savingConfigId: barokahPokok.id,
      balance: 500000,
      isActive: true,
    },
  });

  console.log('✅ Second tenant (Koperasi Syariah Barokah, no accounting package) created');

  // 9. Platform-admin notifications — one of each NotificationType for the notification center demo
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  await prisma.notification.createMany({
    data: [
      {
        type: NotificationType.TENANT_REGISTERED,
        title: 'Koperasi baru terdaftar',
        message: 'Koperasi Syariah Barokah baru saja mendaftar ke platform',
        relatedTenantId: barokah.id,
        createdAt: daysAgo(3),
      },
      {
        type: NotificationType.PACKAGE_CHANGED,
        title: 'Paket langganan diperbarui',
        message: 'Koperasi Demo Sejahtera beralih ke Paket Lengkap (Demo) dengan modul akuntansi',
        relatedTenantId: tenant.id,
        createdAt: daysAgo(2),
      },
      {
        type: NotificationType.BILLING_BLOCKED,
        title: 'Tagihan belum dibayar',
        message: 'Koperasi Syariah Barokah memiliki tagihan yang telah jatuh tempo',
        relatedTenantId: barokah.id,
        createdAt: daysAgo(1),
      },
      {
        type: NotificationType.AUDIT_THRESHOLD_EXCEEDED,
        title: 'Ambang batas audit wajib tercapai',
        message:
          'Modal disetor Koperasi Demo Sejahtera telah mencapai Rp5.000.000.000 — audit wajib sesuai Permenkop UKM No. 2/2024 Pasal 12',
        relatedTenantId: tenant.id,
        createdAt: now,
      },
    ],
  });
  console.log('✅ Sample notifications created');

  console.log('');
  console.log('🎉 Structural seed completed!');
  console.log('');
  console.log('Next: run the transactional demo-data script while the backend dev server is');
  console.log('running (npm run dev), so savings/loans/accounting are created through the real');
  console.log('API and post proper journal entries:');
  console.log('  node prisma/seed-demo-transactions.mjs');
  console.log('');
  console.log('Login credentials:');
  console.log('  Tenant (demo):    http://demo.localhost:5180');
  console.log('    Email:    admin@demo.com');
  console.log('    Password: Admin123!');
  console.log('  Tenant (barokah): http://barokah.localhost:5180');
  console.log('    Email:    admin@barokah.com');
  console.log('    Password: Admin123!');
  console.log('  Platform admin:   http://admin.localhost:5180');
  console.log('    Email:    superadmin@siskop.com');
  console.log('    Password: SuperAdmin123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
