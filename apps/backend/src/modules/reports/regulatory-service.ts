import type { CalkSection } from "@prisma/client";
import { db } from "../../lib/db.js";
import { validationError } from "../../lib/errors.js";
import { splitPrincipalAndInterest } from "../../lib/journal.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const CALK_SECTIONS: CalkSection[] = ["UMUM", "DASAR_PENYUSUNAN", "KEBIJAKAN_AKUNTANSI", "INFORMASI_TAMBAHAN"];

interface AccountSums {
  debit: number;
  credit: number;
}

async function getAccountSumsAsOf(tenantId: string, accountIds: string[] | undefined, cutoff: Date) {
  const sums = await db.journalLine.groupBy({
    by: ["accountId"],
    where: {
      tenantId,
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
      journalEntry: { entryDate: { lte: cutoff } }
    },
    _sum: { debit: true, credit: true }
  });
  return new Map<string, AccountSums>(
    sums.map((s) => [s.accountId, { debit: Number(s._sum.debit ?? 0), credit: Number(s._sum.credit ?? 0) }])
  );
}

async function getAccountSumsInPeriod(tenantId: string, accountIds: string[], from: Date, to: Date) {
  const sums = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { tenantId, accountId: { in: accountIds }, journalEntry: { entryDate: { gte: from, lte: to } } },
    _sum: { debit: true, credit: true }
  });
  return new Map<string, AccountSums>(
    sums.map((s) => [s.accountId, { debit: Number(s._sum.debit ?? 0), credit: Number(s._sum.credit ?? 0) }])
  );
}

/**
 * Reconstructs a member's total savings balance as of a past date by taking the
 * current balance and undoing every transaction that happened after that date.
 * SISKOP doesn't keep daily balance snapshots, so this is exact for the two
 * endpoints of a period (from/to) but "average balance during the period" is
 * then approximated as the mean of those two points rather than a true daily
 * time-weighted average — documented simplification, ported as-is from the
 * pre-rescaffold system (Design Spec 2026-07-22-pelaporan-regulasi §6.4).
 */
async function memberSavingsBalanceAsOf(tenantId: string, memberId: string, date: Date): Promise<number> {
  const savings = await db.saving.findMany({ where: { tenantId, memberId }, select: { id: true, balance: true } });
  if (savings.length === 0) return 0;

  const currentTotal = savings.reduce((sum, s) => sum + Number(s.balance), 0);
  const futureTxns = await db.savingTransaction.findMany({
    where: { tenantId, savingId: { in: savings.map((s) => s.id) }, createdAt: { gt: date } },
    select: { type: true, amount: true }
  });

  const adjustment = futureTxns.reduce(
    (sum, t) => sum + (t.type === "DEPOSIT" ? -Number(t.amount) : Number(t.amount)),
    0
  );
  return round2(currentTotal + adjustment);
}

/**
 * Neraca (Balance Sheet) — Design Spec 2026-07-22-pelaporan-regulasi §6.1.
 * Balances are cumulative from ledger inception through `asOfDate`, sign-adjusted
 * by each account's normalBalance. No closing entries exist for PENDAPATAN/BEBAN
 * (that's the Laporan Hasil Usaha side, deliberately read-only — see
 * getLaporanHasilUsaha), so current-period net income is folded into EKUITAS as
 * a computed "SHU Tahun Berjalan (Belum Ditutup)" line — this is what makes
 * ASET = KEWAJIBAN + EKUITAS hold as an arithmetic property of a balanced trial
 * balance.
 */
export async function getNeraca(tenantId: string, asOfDate: Date) {
  const [accounts, sumsByAccount] = await Promise.all([
    db.account.findMany({ where: { tenantId, isHeader: false }, orderBy: { code: "asc" } }),
    getAccountSumsAsOf(tenantId, undefined, asOfDate)
  ]);

  const balanceFor = (account: (typeof accounts)[number]): number => {
    const sums = sumsByAccount.get(account.id) ?? { debit: 0, credit: 0 };
    return account.normalBalance === "DEBIT" ? sums.debit - sums.credit : sums.credit - sums.debit;
  };

  const buildSection = (category: string) => {
    const items = accounts
      .filter((a) => a.category === category)
      .map((a) => ({ accountId: a.id, code: a.code, name: a.name, balance: round2(balanceFor(a)).toString(), isComputed: false }));
    const total = round2(items.reduce((sum, i) => sum + Number(i.balance), 0));
    return { items, total };
  };

  const aset = buildSection("ASET");
  const kewajiban = buildSection("KEWAJIBAN");
  const ekuitas = buildSection("EKUITAS");

  const totalPendapatan = accounts.filter((a) => a.category === "PENDAPATAN").reduce((sum, a) => sum + balanceFor(a), 0);
  const totalBeban = accounts.filter((a) => a.category === "BEBAN").reduce((sum, a) => sum + balanceFor(a), 0);
  const shuBerjalanBelumDitutup = round2(totalPendapatan - totalBeban);

  const ekuitasItems = [
    ...ekuitas.items,
    {
      accountId: null,
      code: null,
      name: "SHU Tahun Berjalan (Belum Ditutup — Dihitung Otomatis)",
      balance: shuBerjalanBelumDitutup.toString(),
      isComputed: true
    }
  ];
  const ekuitasTotal = round2(ekuitas.total + shuBerjalanBelumDitutup);
  const totalKewajibanDanEkuitas = round2(kewajiban.total + ekuitasTotal);

  return {
    asOfDate: asOfDate.toISOString().split("T")[0],
    aset: { items: aset.items, total: aset.total.toString() },
    kewajiban: { items: kewajiban.items, total: kewajiban.total.toString() },
    ekuitas: { items: ekuitasItems, total: ekuitasTotal.toString() },
    totalKewajibanDanEkuitas: totalKewajibanDanEkuitas.toString(),
    balanced: Math.abs(aset.total - totalKewajibanDanEkuitas) < 0.01
  };
}

/**
 * Laporan Arus Kas (Cash Flow Statement, direct method) — Design Spec §6.3.
 * Groups JournalLines touching accounts marked `isCashEquivalent` into Operasi/
 * Investasi/Pendanaan. SAVING_TRANSACTION/LOAN_PAYMENT/LOAN_DISBURSEMENT are
 * always Operasi (a KSP's lending/savings activity is its core operation).
 * MANUAL entries are classified by the category of their non-cash counter-
 * account: ASET counter -> Investasi, EKUITAS counter -> Pendanaan, otherwise
 * Operasi. Documented assumption, not spec-literal.
 */
export async function getArusKas(tenantId: string, from: Date, to: Date) {
  const cashAccounts = await db.account.findMany({ where: { tenantId, isCashEquivalent: true } });
  const cashAccountIds = cashAccounts.map((a) => a.id);
  const periode = { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] };

  if (cashAccountIds.length === 0) {
    const zero = { rincian: [] as Array<{ label: string; amount: string }>, total: "0" };
    return {
      periode,
      saldoKasAwal: "0",
      aktivitasOperasi: zero,
      aktivitasInvestasi: zero,
      aktivitasPendanaan: zero,
      kenaikanPenurunanKasBersih: "0",
      saldoKasAkhir: "0",
      saldoKasAkhirAktual: "0",
      balanced: true,
      catatan: "Belum ada akun yang ditandai sebagai kas & setara kas (lihat Konfigurasi > Chart of Accounts)"
    };
  }

  const dayBeforeFrom = new Date(from.getTime() - 1);

  const [openingSums, periodLines, closingSums] = await Promise.all([
    getAccountSumsAsOf(tenantId, cashAccountIds, dayBeforeFrom),
    db.journalLine.findMany({
      where: { tenantId, accountId: { in: cashAccountIds }, journalEntry: { entryDate: { gte: from, lte: to } } },
      include: { journalEntry: { include: { lines: { include: { account: true } } } } }
    }),
    getAccountSumsAsOf(tenantId, cashAccountIds, to)
  ]);

  const sumBalances = (sums: Map<string, AccountSums>) =>
    round2(Array.from(sums.values()).reduce((sum, s) => sum + (s.debit - s.credit), 0));

  const saldoKasAwal = sumBalances(openingSums);
  const saldoKasAkhirAktual = sumBalances(closingSums);

  const sectionTotals: Record<"OPERASI" | "INVESTASI" | "PENDANAAN", Map<string, number>> = {
    OPERASI: new Map(),
    INVESTASI: new Map(),
    PENDANAAN: new Map()
  };

  const sectionLabel = (sourceType: string): string => {
    switch (sourceType) {
      case "SAVING_TRANSACTION":
        return "Setoran/Penarikan Simpanan Anggota";
      case "LOAN_PAYMENT":
        return "Penerimaan Angsuran Pinjaman";
      case "LOAN_DISBURSEMENT":
        return "Pencairan Pinjaman ke Anggota";
      default:
        return "Transaksi Manual Lainnya";
    }
  };

  for (const line of periodLines) {
    const net = Number(line.debit) - Number(line.credit);
    const entry = line.journalEntry;

    let section: "OPERASI" | "INVESTASI" | "PENDANAAN" = "OPERASI";
    if (entry.sourceType === "MANUAL") {
      const counter = entry.lines.find((l) => !cashAccountIds.includes(l.accountId));
      if (counter?.account.category === "ASET") section = "INVESTASI";
      else if (counter?.account.category === "EKUITAS") section = "PENDANAAN";
    }

    const label = sectionLabel(entry.sourceType);
    const map = sectionTotals[section];
    map.set(label, round2((map.get(label) ?? 0) + net));
  }

  const toRincian = (map: Map<string, number>) =>
    Array.from(map.entries()).map(([label, amount]) => ({ label, amount: amount.toString() }));
  const totalFor = (map: Map<string, number>) => round2(Array.from(map.values()).reduce((sum, v) => sum + v, 0));

  const totalOperasi = totalFor(sectionTotals.OPERASI);
  const totalInvestasi = totalFor(sectionTotals.INVESTASI);
  const totalPendanaan = totalFor(sectionTotals.PENDANAAN);
  const kenaikanPenurunanKasBersih = round2(totalOperasi + totalInvestasi + totalPendanaan);
  const saldoKasAkhir = round2(saldoKasAwal + kenaikanPenurunanKasBersih);

  return {
    periode,
    saldoKasAwal: saldoKasAwal.toString(),
    aktivitasOperasi: { rincian: toRincian(sectionTotals.OPERASI), total: totalOperasi.toString() },
    aktivitasInvestasi: { rincian: toRincian(sectionTotals.INVESTASI), total: totalInvestasi.toString() },
    aktivitasPendanaan: { rincian: toRincian(sectionTotals.PENDANAAN), total: totalPendanaan.toString() },
    kenaikanPenurunanKasBersih: kenaikanPenurunanKasBersih.toString(),
    saldoKasAkhir: saldoKasAkhir.toString(),
    saldoKasAkhirAktual: saldoKasAkhirAktual.toString(),
    balanced: Math.abs(saldoKasAkhir - saldoKasAkhirAktual) < 0.01
  };
}

/**
 * Laporan Perhitungan Hasil Usaha — Design Spec §6.2. PENDAPATAN - BEBAN for the
 * given period (entryDate range, not cumulative like Neraca). Deliberately
 * read-only: no closing JournalEntry is auto-posted here (that needs its own
 * idempotency design — re-generating the report must not double-post), and
 * getNeraca already accounts for unclosed income via its computed "SHU Tahun
 * Berjalan (Belum Ditutup)" line. Member/non-member split is structurally
 * present but "bukan anggota" stays zero — SISKOP's tenant model is closed-loop.
 */
export async function getLaporanHasilUsaha(tenantId: string, from: Date, to: Date) {
  const accounts = await db.account.findMany({
    where: { tenantId, isHeader: false, category: { in: ["PENDAPATAN", "BEBAN"] } },
    orderBy: { code: "asc" }
  });
  const accountIds = accounts.map((a) => a.id);
  const sumsByAccount = await getAccountSumsInPeriod(tenantId, accountIds, from, to);

  const balanceFor = (account: (typeof accounts)[number]): number => {
    const sums = sumsByAccount.get(account.id) ?? { debit: 0, credit: 0 };
    return account.normalBalance === "DEBIT" ? sums.debit - sums.credit : sums.credit - sums.debit;
  };

  const buildSection = (category: "PENDAPATAN" | "BEBAN") => {
    const items = accounts
      .filter((a) => a.category === category)
      .map((a) => {
        const total = round2(balanceFor(a));
        return { accountId: a.id, code: a.code, name: a.name, anggota: total.toString(), bukanAnggota: "0", total: total.toString() };
      });
    const total = round2(items.reduce((sum, i) => sum + Number(i.total), 0));
    return { items, total: total.toString(), totalRaw: total };
  };

  const pendapatan = buildSection("PENDAPATAN");
  const beban = buildSection("BEBAN");
  const shuBerjalan = round2(pendapatan.totalRaw - beban.totalRaw);

  return {
    periode: { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] },
    pendapatan: { items: pendapatan.items, total: pendapatan.total },
    beban: { items: beban.items, total: beban.total },
    shuBerjalan: shuBerjalan.toString()
  };
}

/**
 * Daftar Pembagian SHU per Anggota — Design Spec §6.4. Allocates the period's
 * SHU (from getLaporanHasilUsaha) across ShuDistributionConfig's four buckets,
 * then divides jasaSimpanan/jasaPinjaman proportionally per active member.
 * Interest-paid is re-derived via splitPrincipalAndInterest over each
 * LoanPayment in the period (same split used at posting time in lib/journal.ts)
 * rather than read off JournalLine, since PAYMENT_INTEREST/PAYMENT_PENALTY both
 * post to PENDAPATAN-category accounts and JournalLine doesn't retain which
 * transactionKind produced a given line.
 */
export async function getShuDistribution(tenantId: string, from: Date, to: Date) {
  const periode = { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] };
  const config = await db.shuDistributionConfig.findUnique({ where: { tenantId } });
  if (!config) {
    return {
      periode,
      shuBerjalan: "0",
      alokasi: null,
      anggota: [],
      catatan: "Konfigurasi alokasi SHU belum diatur (lihat Konfigurasi > Konfigurasi SHU)"
    };
  }

  const { shuBerjalan } = await getLaporanHasilUsaha(tenantId, from, to);
  const shuBerjalanNum = Number(shuBerjalan);

  const jasaSimpananTotal = round2((shuBerjalanNum * Number(config.jasaSimpananPercent)) / 100);
  const jasaPinjamanTotal = round2((shuBerjalanNum * Number(config.jasaPinjamanPercent)) / 100);
  const cadanganTotal = round2((shuBerjalanNum * Number(config.cadanganPercent)) / 100);
  const lainnyaTotal = round2((shuBerjalanNum * Number(config.lainnyaPercent)) / 100);

  const alokasi = {
    jasaSimpanan: { percent: Number(config.jasaSimpananPercent), total: jasaSimpananTotal.toString() },
    jasaPinjaman: { percent: Number(config.jasaPinjamanPercent), total: jasaPinjamanTotal.toString() },
    cadangan: { percent: Number(config.cadanganPercent), total: cadanganTotal.toString() },
    lainnya: { percent: Number(config.lainnyaPercent), total: lainnyaTotal.toString() }
  };

  if (shuBerjalanNum <= 0) {
    return {
      periode,
      shuBerjalan,
      alokasi,
      anggota: [],
      catatan: "Tidak ada SHU positif untuk didistribusikan pada periode ini"
    };
  }

  const members = await db.member.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, memberId: true, fullName: true },
    orderBy: { fullName: "asc" }
  });

  const payments = await db.loanPayment.findMany({
    where: { tenantId, paidAt: { gte: from, lte: to } },
    select: { amount: true, loan: { select: { memberId: true, principalAmount: true, totalAmount: true } } }
  });

  const interestByMember = new Map<string, number>();
  for (const p of payments) {
    const { interest } = splitPrincipalAndInterest(Number(p.amount), Number(p.loan.principalAmount), Number(p.loan.totalAmount));
    interestByMember.set(p.loan.memberId, round2((interestByMember.get(p.loan.memberId) ?? 0) + interest));
  }

  const memberStats = await Promise.all(
    members.map(async (m) => {
      const balAtFrom = await memberSavingsBalanceAsOf(tenantId, m.id, from);
      const balAtTo = await memberSavingsBalanceAsOf(tenantId, m.id, to);
      return {
        memberId: m.id,
        memberCode: m.memberId,
        fullName: m.fullName,
        avgSavingsBalance: round2((balAtFrom + balAtTo) / 2),
        interestPaid: interestByMember.get(m.id) ?? 0
      };
    })
  );

  const totalAvgSavings = round2(memberStats.reduce((sum, m) => sum + m.avgSavingsBalance, 0));
  const totalInterestPaid = round2(memberStats.reduce((sum, m) => sum + m.interestPaid, 0));

  const anggota = memberStats.map((m) => {
    const jasaSimpanan = totalAvgSavings > 0 ? round2((m.avgSavingsBalance / totalAvgSavings) * jasaSimpananTotal) : 0;
    const jasaPinjaman = totalInterestPaid > 0 ? round2((m.interestPaid / totalInterestPaid) * jasaPinjamanTotal) : 0;
    return {
      memberId: m.memberId,
      memberCode: m.memberCode,
      fullName: m.fullName,
      avgSavingsBalance: m.avgSavingsBalance.toString(),
      interestPaid: m.interestPaid.toString(),
      jasaSimpanan: jasaSimpanan.toString(),
      jasaPinjaman: jasaPinjaman.toString(),
      totalShu: round2(jasaSimpanan + jasaPinjaman).toString()
    };
  });

  const totalDibagikanKeAnggota = round2(anggota.reduce((sum, a) => sum + Number(a.totalShu), 0));

  return { periode, shuBerjalan, alokasi, anggota, totalDibagikanKeAnggota: totalDibagikanKeAnggota.toString() };
}

/**
 * CALK (Catatan Atas Laporan Keuangan) — Design Spec §6.5. Fixed narrative
 * sections (accounting policy, basis of preparation, etc.) are rich-text the
 * tenant edits once and reuses every period (persisted in `CalkNarrative`),
 * combined with numeric sections re-derived from the already-built Neraca/
 * Laporan Hasil Usaha. The per-account "mutasi" (movement) column is just the
 * Neraca balance at the period's start minus at its end, both via getNeraca().
 */
export async function getCalk(tenantId: string, from: Date, to: Date) {
  const dayBeforeFrom = new Date(from.getTime() - 1);

  const [neracaAwal, neracaAkhir, laporanHasilUsaha, narrativeRows] = await Promise.all([
    getNeraca(tenantId, dayBeforeFrom),
    getNeraca(tenantId, to),
    getLaporanHasilUsaha(tenantId, from, to),
    db.calkNarrative.findMany({ where: { tenantId } })
  ]);

  const narasi = Object.fromEntries(
    CALK_SECTIONS.map((section) => {
      const row = narrativeRows.find((r) => r.section === section);
      return [section, { content: row?.content ?? "", updatedAt: row?.updatedAt.toISOString() ?? null }];
    })
  );

  type NeracaItem = { accountId: string | null; code: string | null; name: string; balance: string };
  const buildMutasi = (awalItems: NeracaItem[], akhirItems: NeracaItem[]) => {
    const awalByAccount = new Map(awalItems.map((i) => [i.accountId, i]));
    return akhirItems.map((item) => {
      const awal = awalByAccount.get(item.accountId);
      const saldoAwal = awal ? Number(awal.balance) : 0;
      const saldoAkhir = Number(item.balance);
      return {
        accountId: item.accountId,
        code: item.code,
        name: item.name,
        saldoAwal: saldoAwal.toString(),
        saldoAkhir: saldoAkhir.toString(),
        mutasi: round2(saldoAkhir - saldoAwal).toString()
      };
    });
  };

  return {
    periode: { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] },
    narasi,
    rincianAset: buildMutasi(neracaAwal.aset.items, neracaAkhir.aset.items),
    rincianKewajiban: buildMutasi(neracaAwal.kewajiban.items, neracaAkhir.kewajiban.items),
    rincianEkuitas: buildMutasi(neracaAwal.ekuitas.items, neracaAkhir.ekuitas.items),
    rincianPendapatan: laporanHasilUsaha.pendapatan.items,
    rincianBeban: laporanHasilUsaha.beban.items,
    shuBerjalan: laporanHasilUsaha.shuBerjalan
  };
}

export async function upsertCalkNarrative(tenantId: string, section: CalkSection, content: string) {
  return db.calkNarrative.upsert({
    where: { tenantId_section: { tenantId, section } },
    create: { tenantId, section, content },
    update: { content }
  });
}

export function assertValidPeriod(from: Date, to: Date): void {
  if (from.getTime() > to.getTime()) {
    throw validationError("Tanggal awal periode tidak boleh setelah tanggal akhir");
  }
}
