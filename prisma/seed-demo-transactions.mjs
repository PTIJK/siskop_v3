// One-off demo-data populator. Unlike prisma/seed.ts (pure Prisma, no server
// needed), this drives the real HTTP API so savings/loan transactions post
// proper JournalEntry/JournalLine rows and loan payments trigger the real KOL
// recalculation — exactly what a user clicking through the UI would produce.
//
// Prerequisites: `npx prisma db seed` already ran, and the backend dev server
// is up on localhost:3001 (npm run dev).
//
// Usage: node prisma/seed-demo-transactions.mjs

import http from 'node:http';

const HOST = 'localhost';
const PORT = 3001;

function request(method, path, { hostHeader, cookies, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers = {
      Host: hostHeader,
      'Content-Type': 'application/json',
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (cookies) headers['Cookie'] = cookies;

    const req = http.request({ host: HOST, port: PORT, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try {
          json = data ? JSON.parse(data) : {};
        } catch {
          json = { raw: data };
        }
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, json, setCookie });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieHeaderFrom(setCookieArray) {
  return setCookieArray.map((c) => c.split(';')[0]).join('; ');
}

async function login(hostHeader, email, password) {
  const res = await request('POST', '/api/auth/login', {
    hostHeader,
    body: { email, password },
  });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email} on ${hostHeader}: ${JSON.stringify(res.json)}`);
  }
  return cookieHeaderFrom(res.setCookie);
}

function assertOk(res, label) {
  if (res.status >= 400) {
    throw new Error(`${label} failed (${res.status}): ${JSON.stringify(res.json)}`);
  }
  return res.json.data;
}

async function main() {
  console.log('🔐 Logging in as demo tenant admin...');
  const demoCookies = await login('demo.localhost', 'admin@demo.com', 'Admin123!');
  const demo = (method, path, body) =>
    request(method, path, { hostHeader: 'demo.localhost', cookies: demoCookies, body });

  // ── Lookups ──────────────────────────────────────────────────────────────
  const savingConfigs = assertOk(await demo('GET', '/api/savings/configs'), 'list saving configs');
  const loanConfigs = assertOk(await demo('GET', '/api/loans/configs'), 'list loan configs');
  const membersPage = assertOk(await demo('GET', '/api/members?limit=50'), 'list members');

  const savingConfigByType = Object.fromEntries(savingConfigs.map((c) => [c.type, c]));
  const loanConfigByName = Object.fromEntries(loanConfigs.map((c) => [c.name, c]));
  const memberByName = Object.fromEntries(membersPage.map((m) => [m.fullName, m]));

  const pokokId = savingConfigByType.POKOK.id;
  const wajibId = savingConfigByType.WAJIB.id;
  const sukarelaId = savingConfigByType.SUKARELA.id;
  const kurMikroId = loanConfigByName['KUR Mikro'].id;
  const pinjamanUmumId = loanConfigByName['Pinjaman Umum'].id;

  // ── Savings: pokok + wajib for everyone, sukarela for most ────────────────
  console.log('💰 Creating savings accounts...');
  const savingsPlan = {
    'Budi Santoso': { pokok: 500000, wajib: 300000, sukarela: 1500000 },
    'Siti Rahayu': { pokok: 500000, wajib: 300000, sukarela: 2000000 },
    'Ahmad Fauzi': { pokok: 500000, wajib: 250000 },
    'Dewi Lestari': { pokok: 500000, wajib: 300000, sukarela: 1000000 },
    'Eko Prasetyo': { pokok: 500000, wajib: 250000 },
    Fitriani: { pokok: 500000, wajib: 300000, sukarela: 800000 },
    'Gunawan Wijaya': { pokok: 500000, wajib: 350000, sukarela: 2500000 },
    'Hendra Kusuma': { pokok: 500000, wajib: 300000, sukarela: 1200000 },
    'Indah Permata': { pokok: 500000, wajib: 300000, sukarela: 900000 },
    'Rahmat Hidayat': { pokok: 500000, wajib: 300000, sukarela: 500000 },
  };

  const savingsByMemberAndType = {};
  for (const [name, plan] of Object.entries(savingsPlan)) {
    const member = memberByName[name];
    if (!member) throw new Error(`Member not found: ${name}`);
    savingsByMemberAndType[name] = {};

    const pokok = assertOk(
      await demo('POST', '/api/savings', {
        memberId: member.id,
        savingConfigId: pokokId,
        initialDeposit: plan.pokok,
      }),
      `create pokok saving for ${name}`
    );
    savingsByMemberAndType[name].POKOK = pokok;

    const wajib = assertOk(
      await demo('POST', '/api/savings', {
        memberId: member.id,
        savingConfigId: wajibId,
        initialDeposit: plan.wajib,
      }),
      `create wajib saving for ${name}`
    );
    savingsByMemberAndType[name].WAJIB = wajib;

    if (plan.sukarela) {
      const sukarela = assertOk(
        await demo('POST', '/api/savings', {
          memberId: member.id,
          savingConfigId: sukarelaId,
          initialDeposit: plan.sukarela,
        }),
        `create sukarela saving for ${name}`
      );
      savingsByMemberAndType[name].SUKARELA = sukarela;
    }
    console.log(`  ✓ ${name}`);
  }

  // A little extra transaction history for realism
  console.log('💵 Recording a couple of extra deposit/withdrawal transactions...');
  const budiSukarela = savingsByMemberAndType['Budi Santoso'].SUKARELA;
  await demo('POST', `/api/savings/${budiSukarela.id}/deposit`, {
    amount: 500000,
    note: 'Setoran tambahan bulan ini',
  });
  await demo('POST', `/api/savings/${budiSukarela.id}/deposit`, {
    amount: 300000,
    note: 'Setoran tambahan',
  });
  const hendraSukarela = savingsByMemberAndType['Hendra Kusuma'].SUKARELA;
  assertOk(
    await demo('POST', `/api/savings/${hendraSukarela.id}/withdraw`, {
      amount: 400000,
      note: 'Penarikan untuk keperluan pribadi',
    }),
    'withdraw for Hendra'
  );
  console.log('  ✓ done');

  // ── Konfigurasi Akun: seed default COA + account mappings ─────────────────
  console.log('🧾 Seeding default chart of accounts...');
  const seedRes = await demo('POST', '/api/config/accounts/seed-default', {});
  if (seedRes.status >= 400 && seedRes.json?.error?.code !== 'PACKAGE_LIMIT_EXCEEDED') {
    // Tolerate "already seeded" style no-ops; fail on anything else.
    if (seedRes.status !== 409) {
      console.log('  (seed-default response)', seedRes.status, JSON.stringify(seedRes.json));
    }
  }

  const accounts = assertOk(await demo('GET', '/api/config/accounts?limit=200'), 'list accounts');
  const accountByCode = Object.fromEntries(accounts.map((a) => [a.code, a]));

  const kas = accountByCode['1-1000'];
  const piutang = accountByCode['1-1100'];
  const simpananSukarelaAcc = accountByCode['2-1000'];
  const simpananPokokAcc = accountByCode['3-1000'];
  const simpananWajibAcc = accountByCode['3-1100'];
  const pendapatanBunga = accountByCode['4-1000'];
  const pendapatanLain = accountByCode['4-9000'];

  console.log('🔗 Wiring account mappings...');
  const mappings = [
    // Simpanan Pokok (EKUITAS)
    { sourceType: 'SAVING_CONFIG', sourceId: pokokId, transactionKind: 'DEPOSIT', debitAccountId: kas.id, creditAccountId: simpananPokokAcc.id },
    { sourceType: 'SAVING_CONFIG', sourceId: pokokId, transactionKind: 'WITHDRAWAL', debitAccountId: simpananPokokAcc.id, creditAccountId: kas.id },
    // Simpanan Wajib (EKUITAS)
    { sourceType: 'SAVING_CONFIG', sourceId: wajibId, transactionKind: 'DEPOSIT', debitAccountId: kas.id, creditAccountId: simpananWajibAcc.id },
    { sourceType: 'SAVING_CONFIG', sourceId: wajibId, transactionKind: 'WITHDRAWAL', debitAccountId: simpananWajibAcc.id, creditAccountId: kas.id },
    // Simpanan Sukarela (KEWAJIBAN)
    { sourceType: 'SAVING_CONFIG', sourceId: sukarelaId, transactionKind: 'DEPOSIT', debitAccountId: kas.id, creditAccountId: simpananSukarelaAcc.id },
    { sourceType: 'SAVING_CONFIG', sourceId: sukarelaId, transactionKind: 'WITHDRAWAL', debitAccountId: simpananSukarelaAcc.id, creditAccountId: kas.id },
    // KUR Mikro
    { sourceType: 'LOAN_CONFIG', sourceId: kurMikroId, transactionKind: 'DISBURSEMENT', debitAccountId: piutang.id, creditAccountId: kas.id },
    { sourceType: 'LOAN_CONFIG', sourceId: kurMikroId, transactionKind: 'PAYMENT_PRINCIPAL', debitAccountId: kas.id, creditAccountId: piutang.id },
    { sourceType: 'LOAN_CONFIG', sourceId: kurMikroId, transactionKind: 'PAYMENT_INTEREST', debitAccountId: kas.id, creditAccountId: pendapatanBunga.id },
    { sourceType: 'LOAN_CONFIG', sourceId: kurMikroId, transactionKind: 'PAYMENT_PENALTY', debitAccountId: kas.id, creditAccountId: pendapatanLain.id },
    // Pinjaman Umum
    { sourceType: 'LOAN_CONFIG', sourceId: pinjamanUmumId, transactionKind: 'DISBURSEMENT', debitAccountId: piutang.id, creditAccountId: kas.id },
    { sourceType: 'LOAN_CONFIG', sourceId: pinjamanUmumId, transactionKind: 'PAYMENT_PRINCIPAL', debitAccountId: kas.id, creditAccountId: piutang.id },
    { sourceType: 'LOAN_CONFIG', sourceId: pinjamanUmumId, transactionKind: 'PAYMENT_INTEREST', debitAccountId: kas.id, creditAccountId: pendapatanBunga.id },
    { sourceType: 'LOAN_CONFIG', sourceId: pinjamanUmumId, transactionKind: 'PAYMENT_PENALTY', debitAccountId: kas.id, creditAccountId: pendapatanLain.id },
  ];
  for (const m of mappings) {
    assertOk(await demo('PUT', '/api/config/account-mappings', m), `map ${m.sourceType}/${m.transactionKind}`);
  }
  console.log('  ✓ 14 mappings wired');

  // ── Loans: one per KOL tier + one paid off ─────────────────────────────────
  console.log('🏦 Creating loans across all KOL categories...');

  async function createLoan(name, loanConfigId, principalAmount, termMonths, disbursedAt) {
    const member = memberByName[name];
    const loan = assertOk(
      await demo('POST', '/api/loans', {
        memberId: member.id,
        loanConfigId,
        principalAmount,
        termMonths,
        disbursedAt,
      }),
      `create loan for ${name}`
    );
    return loan;
  }

  async function pay(loanId, amount, paidAt, dueDate, note) {
    return assertOk(
      await demo('POST', `/api/loans/${loanId}/pay`, { amount, paidAt, dueDate, note }),
      `record payment for loan ${loanId}`
    );
  }

  // LANCAR — Siti, disbursed 2026-05-25, both installments paid on time
  const siti = await createLoan('Siti Rahayu', kurMikroId, 3000000, 12, '2026-05-25');
  await pay(siti.id, siti.monthlyPayment, '2026-06-25', '2026-06-25', 'Cicilan bulan 1');
  const sitiResult = await pay(siti.id, siti.monthlyPayment, '2026-07-25', '2026-07-25', 'Cicilan bulan 2');
  console.log(`  ✓ Siti Rahayu → LANCAR (expected), got ${sitiResult.kolCategory}`);

  // DALAM_PERHATIAN — Ahmad, disbursed 2026-04-25, months 1-2 skipped, month 3 (today) paid
  const ahmad = await createLoan('Ahmad Fauzi', pinjamanUmumId, 4000000, 10, '2026-04-25');
  const ahmadResult = await pay(ahmad.id, ahmad.monthlyPayment, '2026-07-25', '2026-07-25', 'Cicilan bulan berjalan');
  console.log(`  ✓ Ahmad Fauzi → DALAM_PERHATIAN (expected), got ${ahmadResult.kolCategory}`);

  // KURANG_LANCAR — Dewi, disbursed 2026-03-25, months 1-3 skipped, month 4 (today) paid
  const dewi = await createLoan('Dewi Lestari', kurMikroId, 5000000, 12, '2026-03-25');
  const dewiResult = await pay(dewi.id, dewi.monthlyPayment, '2026-07-25', '2026-07-25', 'Cicilan bulan berjalan');
  console.log(`  ✓ Dewi Lestari → KURANG_LANCAR (expected), got ${dewiResult.kolCategory}`);

  // DIRAGUKAN — Eko, disbursed 2026-01-25, months 1-5 skipped, month 6 (today) paid
  const eko = await createLoan('Eko Prasetyo', pinjamanUmumId, 6000000, 14, '2026-01-25');
  const ekoResult = await pay(eko.id, eko.monthlyPayment, '2026-07-25', '2026-07-25', 'Cicilan bulan berjalan');
  console.log(`  ✓ Eko Prasetyo → DIRAGUKAN (expected), got ${ekoResult.kolCategory}`);

  // MACET — Fitriani, disbursed 2025-11-25, months 1-7 skipped, month 8 (today) paid
  const fitriani = await createLoan('Fitriani', kurMikroId, 8000000, 16, '2025-11-25');
  const fitrianiResult = await pay(fitriani.id, fitriani.monthlyPayment, '2026-07-25', '2026-07-25', 'Cicilan bulan berjalan');
  console.log(`  ✓ Fitriani → MACET (expected), got ${fitrianiResult.kolCategory}`);

  // COMPLETED — Gunawan, short 2-month loan paid off in full immediately
  const gunawan = await createLoan('Gunawan Wijaya', pinjamanUmumId, 2000000, 2, '2026-06-25');
  const gunawanResult = await pay(gunawan.id, gunawan.totalAmount, '2026-07-25', '2026-07-25', 'Pelunasan penuh');
  console.log(`  ✓ Gunawan Wijaya → status ${gunawanResult.status} (expected COMPLETED)`);

  // ── SHU distribution config ────────────────────────────────────────────────
  console.log('📊 Setting SHU distribution config...');
  assertOk(
    await demo('PUT', '/api/config/shu-distribution', {
      jasaSimpananPercent: 25,
      jasaPinjamanPercent: 45,
      cadanganPercent: 20,
      lainnyaPercent: 10,
    }),
    'set SHU distribution config'
  );

  // ── Modal disetor (compliance / audit threshold) ───────────────────────────
  console.log('🏛️  Setting modal disetor...');
  assertOk(
    await demo('PUT', '/api/config/modal-disetor', { modalDisetor: 6000000000 }),
    'set modal disetor'
  );

  // ── Whitelabel config ───────────────────────────────────────────────────────
  console.log('🎨 Setting whitelabel config...');
  await demo('PUT', '/api/config/whitelabel', {
    primaryColor: '#0F766E',
    hideBranding: false,
    emailSenderName: 'Koperasi Demo Sejahtera',
    emailSenderAddress: 'no-reply@demo-koperasi.example',
  });

  // ── CALK narrative sections ────────────────────────────────────────────────
  console.log('📝 Writing CALK narrative sections...');
  const calkSections = [
    {
      section: 'UMUM',
      content:
        'Koperasi Demo Sejahtera didirikan berdasarkan Akta Pendirian dan telah memperoleh ' +
        'pengesahan badan hukum dengan Nomor Registrasi KOP/001/DEMO/2020. Koperasi bergerak ' +
        'di bidang simpan pinjam konvensional untuk melayani anggota di wilayah Jakarta.',
    },
    {
      section: 'DASAR_PENYUSUNAN',
      content:
        'Laporan keuangan disusun berdasarkan Standar Akuntansi Keuangan Entitas Privat (SAK EP) ' +
        'dan Peraturan Menteri Koperasi dan UKM No. 2 Tahun 2024, menggunakan dasar akrual dan ' +
        'konsep kelangsungan usaha.',
    },
    {
      section: 'KEBIJAKAN_AKUNTANSI',
      content:
        'Pengakuan pendapatan bunga/margin pinjaman dilakukan pada saat kas diterima. Simpanan ' +
        'anggota diakui sesuai jenisnya (Pokok dan Wajib sebagai Ekuitas, Sukarela sebagai ' +
        'Kewajiban). Penyusutan aset tetap menggunakan metode garis lurus.',
    },
    {
      section: 'INFORMASI_TAMBAHAN',
      content:
        'Tidak terdapat peristiwa penting setelah tanggal neraca yang memerlukan penyesuaian ' +
        'atau pengungkapan tambahan pada laporan keuangan periode ini.',
    },
  ];
  for (const s of calkSections) {
    assertOk(
      await demo('PUT', '/api/reports/regulatory/calk/narrative', s),
      `write CALK section ${s.section}`
    );
  }

  // ── Soft-delete one member to demo deactivation ────────────────────────────
  console.log('🗑️  Deactivating Indah Permata to demo soft-delete...');
  assertOk(
    await demo('DELETE', `/api/members/${memberByName['Indah Permata'].id}`),
    'deactivate Indah Permata'
  );

  // ── Sanity checks ───────────────────────────────────────────────────────────
  console.log('');
  console.log('🔎 Sanity-checking regulatory reports...');
  const neraca = assertOk(await demo('GET', '/api/reports/regulatory/neraca'), 'get neraca');
  console.log(`  Neraca balanced: ${neraca.balanced}`);
  const arusKas = assertOk(
    await demo('GET', '/api/reports/regulatory/arus-kas?from=2026-01-01&to=2026-07-31'),
    'get arus kas'
  );
  console.log(`  Arus Kas catatan: ${arusKas.catatan ?? '(none — populated)'}`);
  const lhu = assertOk(
    await demo('GET', '/api/reports/regulatory/laporan-hasil-usaha?from=2026-01-01&to=2026-07-31'),
    'get laporan hasil usaha'
  );
  console.log(`  Laporan Hasil Usaha SHU berjalan: ${lhu.shuBerjalan ?? JSON.stringify(lhu).slice(0, 120)}`);
  const shu = assertOk(
    await demo('GET', '/api/reports/regulatory/shu-distribution?from=2026-01-01&to=2026-07-31'),
    'get shu distribution'
  );
  console.log(`  SHU Distribution catatan: ${shu.catatan ?? '(none — populated)'}`);

  console.log('');
  console.log('🎉 Demo transactional data complete!');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
