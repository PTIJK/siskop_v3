// One-off demo-data populator. Unlike prisma/seed.ts (pure Prisma, no server
// needed), this drives the real HTTP API so savings/loan transactions post
// proper JournalEntry/JournalLine rows and loan payments trigger the real KOL
// recalculation — exactly what a user clicking through the UI would produce.
//
// Prerequisites: `pnpm --filter @siskop/backend db:seed` already ran, and the
// backend dev server is up on localhost:3001 (pnpm run dev).
//
// Usage: node prisma/seed-demo-transactions.mjs

import http from "node:http";
import { subMonths, format } from "date-fns";

const HOST = "localhost";
const PORT = 3001;

function request(method, path, { hostHeader, token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers = {
      Host: hostHeader,
      "Content-Type": "application/json"
    };
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = http.request({ host: HOST, port: PORT, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json;
        try {
          json = data ? JSON.parse(data) : {};
        } catch {
          json = { raw: data };
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(hostHeader, email, password) {
  const res = await request("POST", "/api/auth/login", { hostHeader, body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email} on ${hostHeader}: ${JSON.stringify(res.json)}`);
  }
  return res.json.data.accessToken;
}

function assertOk(res, label) {
  if (res.status >= 400) {
    throw new Error(`${label} failed (${res.status}): ${JSON.stringify(res.json)}`);
  }
  return res.json.data;
}

// KOL classification is driven by how many months have elapsed since
// disbursement with no matching payment — anchored to "today" (script-run
// time) rather than a fixed date, so this script stays valid whenever it runs.
const today = new Date();
const iso = (d) => format(d, "yyyy-MM-dd");
const monthsAgo = (n) => iso(subMonths(today, n));

async function main() {
  console.log("Logging in as demo tenant admin...");
  const demoToken = await login("demo.localhost", "admin@demo.com", "Admin123!");
  const demo = (method, path, body) => request(method, path, { hostHeader: "demo.localhost", token: demoToken, body });

  // ── Lookups ──────────────────────────────────────────────────────────────
  const savingConfigs = assertOk(await demo("GET", "/api/savings/configs"), "list saving configs");
  const loanConfigs = assertOk(await demo("GET", "/api/loans/configs"), "list loan configs");
  const membersPage = assertOk(await demo("GET", "/api/members?limit=50"), "list members");

  const savingConfigByType = Object.fromEntries(savingConfigs.map((c) => [c.type, c]));
  const loanConfigByName = Object.fromEntries(loanConfigs.map((c) => [c.name, c]));
  const memberByName = Object.fromEntries(membersPage.map((m) => [m.fullName, m]));

  const pokokId = savingConfigByType.POKOK.id;
  const wajibId = savingConfigByType.WAJIB.id;
  const sukarelaId = savingConfigByType.SUKARELA.id;
  const kurMikroId = loanConfigByName["KUR Mikro"].id;
  const pinjamanUmumId = loanConfigByName["Pinjaman Umum"].id;

  // ── Savings: pokok + wajib for everyone, sukarela for most ────────────────
  console.log("Creating savings accounts...");
  const savingsPlan = {
    "Budi Santoso": { pokok: 500000, wajib: 300000, sukarela: 1500000 },
    "Siti Rahayu": { pokok: 500000, wajib: 300000, sukarela: 2000000 },
    "Ahmad Fauzi": { pokok: 500000, wajib: 250000 },
    "Dewi Lestari": { pokok: 500000, wajib: 300000, sukarela: 1000000 },
    "Eko Prasetyo": { pokok: 500000, wajib: 250000 },
    Fitriani: { pokok: 500000, wajib: 300000, sukarela: 800000 },
    "Gunawan Wijaya": { pokok: 500000, wajib: 350000, sukarela: 2500000 },
    "Hendra Kusuma": { pokok: 500000, wajib: 300000, sukarela: 1200000 },
    "Indah Permata": { pokok: 500000, wajib: 300000, sukarela: 900000 },
    "Rahmat Hidayat": { pokok: 500000, wajib: 300000, sukarela: 500000 }
  };

  const savingsByMemberAndType = {};
  for (const [name, plan] of Object.entries(savingsPlan)) {
    const member = memberByName[name];
    if (!member) throw new Error(`Member not found: ${name}`);
    savingsByMemberAndType[name] = {};

    const pokok = assertOk(
      await demo("POST", "/api/savings", { memberId: member.id, savingConfigId: pokokId, initialDeposit: plan.pokok }),
      `create pokok saving for ${name}`
    );
    savingsByMemberAndType[name].POKOK = pokok;

    const wajib = assertOk(
      await demo("POST", "/api/savings", { memberId: member.id, savingConfigId: wajibId, initialDeposit: plan.wajib }),
      `create wajib saving for ${name}`
    );
    savingsByMemberAndType[name].WAJIB = wajib;

    if (plan.sukarela) {
      const sukarela = assertOk(
        await demo("POST", "/api/savings", { memberId: member.id, savingConfigId: sukarelaId, initialDeposit: plan.sukarela }),
        `create sukarela saving for ${name}`
      );
      savingsByMemberAndType[name].SUKARELA = sukarela;
    }
    console.log(`  ${name}`);
  }

  // A little extra transaction history for realism
  console.log("Recording a couple of extra deposit/withdrawal transactions...");
  const budiSukarela = savingsByMemberAndType["Budi Santoso"].SUKARELA;
  await demo("POST", `/api/savings/${budiSukarela.id}/deposit`, { amount: 500000, note: "Setoran tambahan bulan ini" });
  await demo("POST", `/api/savings/${budiSukarela.id}/deposit`, { amount: 300000, note: "Setoran tambahan" });
  const hendraSukarela = savingsByMemberAndType["Hendra Kusuma"].SUKARELA;
  assertOk(
    await demo("POST", `/api/savings/${hendraSukarela.id}/withdraw`, { amount: 400000, note: "Penarikan untuk keperluan pribadi" }),
    "withdraw for Hendra"
  );
  console.log("  done");

  // ── Loans: one per KOL tier + one paid off ─────────────────────────────────
  console.log("Creating loans across all KOL categories...");

  async function createLoan(name, loanConfigId, principalAmount, termMonths, disbursedAt) {
    const member = memberByName[name];
    return assertOk(
      await demo("POST", "/api/loans", { memberId: member.id, loanConfigId, principalAmount, termMonths, disbursedAt }),
      `create loan for ${name}`
    );
  }

  async function pay(loanId, amount, paidAt, dueDate, note) {
    return assertOk(await demo("POST", `/api/loans/${loanId}/pay`, { amount, paidAt, dueDate, note }), `record payment for loan ${loanId}`);
  }

  // LANCAR — Siti, disbursed 2 months ago, both installments paid on time
  const siti = await createLoan("Siti Rahayu", kurMikroId, 3000000, 12, monthsAgo(2));
  await pay(siti.id, siti.monthlyPayment, monthsAgo(1), monthsAgo(1), "Cicilan bulan 1");
  const sitiResult = await pay(siti.id, siti.monthlyPayment, iso(today), iso(today), "Cicilan bulan 2");
  console.log(`  Siti Rahayu -> LANCAR (expected), got ${sitiResult.kolCategory}`);

  // DALAM_PERHATIAN — Ahmad, disbursed 3 months ago, months 1-2 skipped, month 3 (today) paid
  const ahmad = await createLoan("Ahmad Fauzi", pinjamanUmumId, 4000000, 10, monthsAgo(3));
  const ahmadResult = await pay(ahmad.id, ahmad.monthlyPayment, iso(today), iso(today), "Cicilan bulan berjalan");
  console.log(`  Ahmad Fauzi -> DALAM_PERHATIAN (expected), got ${ahmadResult.kolCategory}`);

  // KURANG_LANCAR — Dewi, disbursed 4 months ago, months 1-3 skipped, month 4 (today) paid
  const dewi = await createLoan("Dewi Lestari", kurMikroId, 5000000, 12, monthsAgo(4));
  const dewiResult = await pay(dewi.id, dewi.monthlyPayment, iso(today), iso(today), "Cicilan bulan berjalan");
  console.log(`  Dewi Lestari -> KURANG_LANCAR (expected), got ${dewiResult.kolCategory}`);

  // DIRAGUKAN — Eko, disbursed 6 months ago, months 1-5 skipped, month 6 (today) paid
  const eko = await createLoan("Eko Prasetyo", pinjamanUmumId, 6000000, 14, monthsAgo(6));
  const ekoResult = await pay(eko.id, eko.monthlyPayment, iso(today), iso(today), "Cicilan bulan berjalan");
  console.log(`  Eko Prasetyo -> DIRAGUKAN (expected), got ${ekoResult.kolCategory}`);

  // MACET — Fitriani, disbursed 8 months ago, months 1-7 skipped, month 8 (today) paid
  const fitriani = await createLoan("Fitriani", kurMikroId, 8000000, 16, monthsAgo(8));
  const fitrianiResult = await pay(fitriani.id, fitriani.monthlyPayment, iso(today), iso(today), "Cicilan bulan berjalan");
  console.log(`  Fitriani -> MACET (expected), got ${fitrianiResult.kolCategory}`);

  // COMPLETED — Gunawan, short 2-month loan paid off in full immediately
  const gunawan = await createLoan("Gunawan Wijaya", pinjamanUmumId, 2000000, 2, monthsAgo(1));
  const gunawanResult = await pay(gunawan.id, gunawan.totalAmount, iso(today), iso(today), "Pelunasan penuh");
  console.log(`  Gunawan Wijaya -> status ${gunawanResult.status} (expected COMPLETED)`);

  // ── Soft-delete one member to demo deactivation ────────────────────────────
  console.log("Deactivating Indah Permata to demo soft-delete...");
  assertOk(await demo("DELETE", `/api/members/${memberByName["Indah Permata"].id}`), "deactivate Indah Permata");

  console.log("");
  console.log("Demo transactional data complete!");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
