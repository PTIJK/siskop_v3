import { PrismaClient, TenantType, SavingType, RateType, LoanType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // 1. Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Koperasi Demo Sejahtera',
      slug: 'demo',
      address: 'Jl. Merdeka No. 1, Jakarta Pusat, DKI Jakarta',
      registrationNo: 'KOP/001/DEMO/2020',
      type: TenantType.KONVENSIONAL,
      cooperativeType: 'Koperasi Simpan Pinjam',
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
    reports: { read: true, export: true },
    config: { read: true, update: true },
    users: { create: true, read: true, update: true, delete: true },
    roles: { create: true, read: true, update: true, delete: true },
  };

  const superAdminRole = await prisma.role.upsert({
    where: { id: `${tenant.id}_super_admin` },
    update: {},
    create: {
      id: `${tenant.id}_super_admin`,
      tenantId: tenant.id,
      name: 'Super Admin',
      permissions: defaultPermissions,
    },
  });

  const managerRole = await prisma.role.upsert({
    where: { id: `${tenant.id}_manager` },
    update: {},
    create: {
      id: `${tenant.id}_manager`,
      tenantId: tenant.id,
      name: 'Manager',
      permissions: {
        ...defaultPermissions,
        config: { read: true, update: false },
        users: { create: false, read: true, update: false, delete: false },
        roles: { create: false, read: true, update: false, delete: false },
      },
    },
  });

  // Suppress unused warning for managerRole (used only as seed data)
  void managerRole;

  await prisma.role.upsert({
    where: { id: `${tenant.id}_teller` },
    update: {},
    create: {
      id: `${tenant.id}_teller`,
      tenantId: tenant.id,
      name: 'Teller',
      permissions: {
        dashboard: { read: true },
        members: { create: false, read: true, update: false, delete: false },
        savings: { create: true, read: true, update: true, delete: false },
        loans: { create: false, read: true, update: true, delete: false },
        reports: { read: false, export: false },
        config: { read: false, update: false },
        users: { create: false, read: false, update: false, delete: false },
        roles: { create: false, read: false, update: false, delete: false },
      },
    },
  });

  await prisma.role.upsert({
    where: { id: `${tenant.id}_viewer` },
    update: {},
    create: {
      id: `${tenant.id}_viewer`,
      tenantId: tenant.id,
      name: 'Viewer',
      permissions: {
        dashboard: { read: true },
        members: { create: false, read: true, update: false, delete: false },
        savings: { create: false, read: true, update: false, delete: false },
        loans: { create: false, read: true, update: false, delete: false },
        reports: { read: true, export: false },
        config: { read: false, update: false },
        users: { create: false, read: false, update: false, delete: false },
        roles: { create: false, read: false, update: false, delete: false },
      },
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

  void simpananWajib;

  await prisma.savingConfig.upsert({
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

  // 6. Create 3 sample members
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
  ];

  for (const [index, m] of members.entries()) {
    const seq = String(index + 1).padStart(4, '0');
    const memberId = `KOP-DEMO-202606-${seq}`;
    const accountNumber = `ACC-${3847291000 + index}`;

    const member = await prisma.member.upsert({
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

    await prisma.saving.upsert({
      where: { id: `saving_pokok_${member.id}` },
      update: {},
      create: {
        id: `saving_pokok_${member.id}`,
        tenantId: tenant.id,
        memberId: member.id,
        savingConfigId: simpananPokok.id,
        balance: 500000,
        isActive: true,
      },
    });
  }

  console.log('✅ Sample members created with simpanan pokok');

  // 7. Create platform admin user
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
  console.log('✅ Platform admin created');

  console.log('');
  console.log('🎉 Seed completed!');
  console.log('');
  console.log('Login credentials:');
  console.log('  URL:      http://demo.localhost:5173 (or demo.siskop.com)');
  console.log('  Email:    admin@demo.com');
  console.log('  Password: Admin123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
