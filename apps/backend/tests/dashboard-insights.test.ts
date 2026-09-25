import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { classifyKsp } from "../src/lib/regulatory-config.js";
import { app, createMemberAs, postEquity, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

let nikSeq = 0;
function nextNik() {
  nikSeq += 1;
  return `31710000000${String(nikSeq).padStart(5, "0")}`;
}

function get(accessToken: string, path: string, query: Record<string, string> = {}) {
  return request(app()).get(`/api/dashboard${path}`).query(query).set("Authorization", `Bearer ${accessToken}`);
}

async function savingConfig(accessToken: string, type: "POKOK" | "WAJIB" | "SUKARELA") {
  const res = await request(app())
    .post("/api/savings/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: `Simpanan ${type}`, type, rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
  return res.body.data.id as string;
}

async function openSaving(accessToken: string, memberId: string, configId: string, amount: number) {
  await request(app())
    .post("/api/savings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ memberId, savingConfigId: configId, initialDeposit: amount });
}

async function loanConfig(accessToken: string) {
  const res = await request(app())
    .post("/api/loans/configs")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "KUR", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
  return res.body.data.id as string;
}

/** An ACTIVE loan (created through the API, so it is real), then forced into `kol` with `remaining` outstanding. */
async function loanWith(
  admin: { accessToken: string; user: { tenantId: string } },
  memberId: string,
  configId: string,
  opts: { principal: number; remaining: number; kol: "LANCAR" | "DALAM_PERHATIAN" | "KURANG_LANCAR" | "DIRAGUKAN" | "MACET" }
) {
  const res = await request(app())
    .post("/api/loans")
    .set("Authorization", `Bearer ${admin.accessToken}`)
    .send({ memberId, loanConfigId: configId, principalAmount: opts.principal, termMonths: 12, force: true, acknowledgeBmpp: true });
  const id = res.body.data.id as string;
  await db.loan.update({
    where: { id, tenantId: admin.user.tenantId },
    data: { kolCategory: opts.kol, remainingAmount: opts.remaining }
  });
  return id;
}

async function memberWithPokok(accessToken: string, pokokConfig: string, overrides: Record<string, unknown> = {}) {
  const member = await createMemberAs(accessToken, { nik: nextNik(), ...overrides });
  await openSaving(accessToken, member.id, pokokConfig, 100_000);
  return member;
}

describe("GET /api/dashboard/summary — equity vs liability savings", () => {
  it("splits simpanan pokok/wajib (equity) from sukarela (a liability)", async () => {
    const admin = await setupTenant();
    const pokok = await savingConfig(admin.accessToken, "POKOK");
    const wajib = await savingConfig(admin.accessToken, "WAJIB");
    const sukarela = await savingConfig(admin.accessToken, "SUKARELA");
    const member = await createMemberAs(admin.accessToken, { nik: nextNik() });
    await openSaving(admin.accessToken, member.id, pokok, 100_000);
    await openSaving(admin.accessToken, member.id, wajib, 250_000);
    await openSaving(admin.accessToken, member.id, sukarela, 1_000_000);

    const res = await get(admin.accessToken, "/summary");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalSavings: "1350000", savingsEquity: "350000", savingsLiability: "1000000" });
  });

  it("compares with last month: members joined before this month and last month's repayments", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    const older = await createMemberAs(admin.accessToken, { nik: nextNik() });
    await createMemberAs(admin.accessToken, { nik: nextNik() });
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1, 15);
    await db.member.update({ where: { id: older.id, tenantId }, data: { createdAt: lastMonth } });

    const res = await get(admin.accessToken, "/summary");

    expect(res.body.data.memberCount).toBe(2);
    expect(res.body.data.previous).toEqual({ memberCount: 1, monthlyPayments: "0" });
  });
});

describe("GET /api/dashboard/loan-quality", () => {
  it("breaks outstanding down by KOL and derives NPL and LDR", async () => {
    const admin = await setupTenant();
    const pokok = await savingConfig(admin.accessToken, "POKOK");
    const sukarela = await savingConfig(admin.accessToken, "SUKARELA");
    const config = await loanConfig(admin.accessToken);
    const a = await memberWithPokok(admin.accessToken, pokok);
    const b = await memberWithPokok(admin.accessToken, pokok, { fullName: "Siti Aminah" });
    await openSaving(admin.accessToken, a.id, sukarela, 4_000_000);
    await loanWith(admin, a.id, config, { principal: 1_000_000, remaining: 800_000, kol: "LANCAR" });
    await loanWith(admin, a.id, config, { principal: 1_000_000, remaining: 600_000, kol: "DALAM_PERHATIAN" });
    await loanWith(admin, b.id, config, { principal: 1_000_000, remaining: 400_000, kol: "KURANG_LANCAR" });
    await loanWith(admin, b.id, config, { principal: 1_000_000, remaining: 200_000, kol: "MACET" });

    const res = await get(admin.accessToken, "/loan-quality");

    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body.totalOutstanding).toBe("2000000");
    expect(body.byKol).toEqual([
      { category: "LANCAR", count: 1, outstanding: "800000" },
      { category: "DALAM_PERHATIAN", count: 1, outstanding: "600000" },
      { category: "KURANG_LANCAR", count: 1, outstanding: "400000" },
      { category: "DIRAGUKAN", count: 0, outstanding: "0" },
      { category: "MACET", count: 1, outstanding: "200000" }
    ]);
    expect(body.nplRatio).toBe("30.00"); // (400k + 200k) / 2,000k
    expect(body.ldr).toBe("50.00"); // 2,000k outstanding / 4,000k sukarela
    expect(body.topOverdue.map((l: { outstanding: string }) => l.outstanding)).toEqual(["600000", "400000", "200000"]);
    expect(body.topOverdue[1]).toMatchObject({ memberName: "Siti Aminah", kolCategory: "KURANG_LANCAR" });
  });

  it("returns null ratios when there is nothing to divide by", async () => {
    const admin = await setupTenant();

    const res = await get(admin.accessToken, "/loan-quality");

    expect(res.body.data).toMatchObject({ totalOutstanding: "0", nplRatio: null, ldr: null, topOverdue: [] });
  });
});

describe("GET /api/dashboard/capital", () => {
  it("reports Modal Sendiri, its ratio to total assets and the audit-threshold progress", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "SIMPANAN_POKOK", 1_000_000_000);
    await postEquity(admin.user.tenantId, "CADANGAN_UMUM", 500_000_000);
    await postEquity(admin.user.tenantId, "MODAL_PENYERTAAN", 2_500_000_000); // an asset, but not Modal Sendiri

    const res = await get(admin.accessToken, "/capital");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      modalSendiri: "1500000000",
      totalAset: "4000000000",
      rasioModalSendiriAset: "37.50",
      audit: { threshold: "5000000000", progressPct: "30.00", reached: false, applies: true },
      klasifikasi: "KSP_I"
    });
    expect(res.body.data.komposisi).toEqual([
      { equityClass: "SIMPANAN_POKOK", amount: "1000000000" },
      { equityClass: "CADANGAN_UMUM", amount: "500000000" }
    ]);
    expect(res.body.data.trend).toHaveLength(12);
    expect(res.body.data.trend.at(-1).value).toBe("1500000000");
  });

  it("lists the members nearest their BMPP limit and those holding over 20% of Modal Sendiri", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", 10_000_000, { entryDate: new Date("2020-01-01T00:00:00Z") });
    const pokok = await savingConfig(admin.accessToken, "POKOK");
    const wajib = await savingConfig(admin.accessToken, "WAJIB");
    const config = await loanConfig(admin.accessToken);
    const pengurus = await memberWithPokok(admin.accessToken, pokok, { fullName: "Pak Ketua", isPengurus: true });
    const anggota = await memberWithPokok(admin.accessToken, pokok, { fullName: "Bu Anggota" });
    await openSaving(admin.accessToken, anggota.id, wajib, 2_000_000); // 2.1M of 10M > 20%
    await loanWith(admin, pengurus.id, config, { principal: 800_000, remaining: 800_000, kol: "LANCAR" });
    await loanWith(admin, anggota.id, config, { principal: 600_000, remaining: 600_000, kol: "LANCAR" });

    const res = await get(admin.accessToken, "/capital");

    expect(res.body.data.bmpp.topBorrowers).toEqual([
      {
        memberId: pengurus.id,
        memberName: "Pak Ketua",
        isRelatedParty: true,
        principal: "800000",
        limitPct: 10,
        limit: "1000000",
        usagePct: "80.00"
      },
      {
        memberId: anggota.id,
        memberName: "Bu Anggota",
        isRelatedParty: false,
        principal: "600000",
        limitPct: 15,
        limit: "1500000",
        usagePct: "40.00"
      }
    ]);
    expect(res.body.data.konsentrasiSimpanan).toEqual([
      { memberId: anggota.id, memberName: "Bu Anggota", amount: "2100000", pctOfModalSendiri: "21.00" }
    ]);
  });

  it("scopes to a unit when unitId is given", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    const ksp = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
    await db.cooperativeUnit.create({ data: { tenantId, type: "KONSUMEN", name: "Toko" } });
    await postEquity(tenantId, "MODAL_TETAP", 3_000_000, { unitId: ksp.id });
    await postEquity(tenantId, "SIMPANAN_POKOK", 7_000_000);

    const [all, unit] = await Promise.all([get(admin.accessToken, "/capital"), get(admin.accessToken, "/capital", { unitId: ksp.id })]);

    expect(all.body.data.modalSendiri).toBe("10000000");
    expect(unit.body.data.modalSendiri).toBe("3000000");
  });

  it("404s a unit belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId } });

    const res = await get(tenantA.accessToken, "/capital", { unitId: unitB.id });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/dashboard/growth", () => {
  it("returns 12 monthly points of new members, net savings flow, disbursement and repayment", async () => {
    const admin = await setupTenant();
    const pokok = await savingConfig(admin.accessToken, "POKOK");
    const config = await loanConfig(admin.accessToken);
    const member = await memberWithPokok(admin.accessToken, pokok);
    const loanId = await loanWith(admin, member.id, config, { principal: 1_000_000, remaining: 1_000_000, kol: "LANCAR" });
    const today = new Date().toISOString().slice(0, 10);
    const payment = await request(app())
      .post(`/api/loans/${loanId}/pay`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ amount: 100_000, paidAt: today, dueDate: today });
    expect(payment.status).toBe(200);

    const res = await get(admin.accessToken, "/growth");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.data.at(-1)).toMatchObject({
      newMembers: 1,
      savingsNetFlow: "100000",
      disbursement: "1000000",
      repayment: "100000"
    });
  });
});

describe("classifyKsp (Permenkop UKM 8/2023 Pasal 49)", () => {
  it("takes the highest class any criterion puts the koperasi in", () => {
    expect(classifyKsp({ members: 100, modalSendiri: "1000000000", aset: "5000000000" })).toBe("KSP_I");
    expect(classifyKsp({ members: 6_000, modalSendiri: "1000000000", aset: "5000000000" })).toBe("KSP_II");
    expect(classifyKsp({ members: 100, modalSendiri: "20000000000", aset: "5000000000" })).toBe("KSP_III");
    expect(classifyKsp({ members: 100, modalSendiri: "1000000000", aset: "600000000000" })).toBe("KSP_IV");
  });

  it("puts the exact upper bounds in the lower class", () => {
    expect(classifyKsp({ members: 5_000, modalSendiri: "2500000000", aset: "15000000000" })).toBe("KSP_I");
  });
});
