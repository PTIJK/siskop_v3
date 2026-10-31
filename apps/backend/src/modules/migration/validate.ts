import { Prisma } from "@prisma/client";
import type { MigrationIssue, MigrationTotals } from "@siskop/types";
import { COA_TEMPLATE } from "../../lib/coaTemplate.js";
import { validateRegulatoryRate } from "../../lib/regulatory-config.js";
import { assertFrequencyMethodCompatible } from "../loans/service.js";
import type { ParsedData } from "./rows.js";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

/** Reports are handed to the koperasi, so a NIK is never repeated in full in a message. */
const maskNik = (nik: string) => `****${nik.slice(-4)}`;

export interface AccountInfo {
  code: string;
  name: string;
  normalBalance: "DEBIT" | "KREDIT";
  isHeader: boolean;
}

/** Standard COA the new tenant will get (unit-gated accounts only if the unit exists) plus sheet 10. */
export function accountIndex(data: ParsedData): Map<string, AccountInfo> {
  const types = new Set<string>(data.units.map((u) => u.type));
  const index = new Map<string, AccountInfo>();
  for (const a of COA_TEMPLATE) {
    if (a.unitType && !types.has(a.unitType)) continue;
    if (a.multiUnitOnly && data.units.length <= 1) continue;
    index.set(a.code, { code: a.code, name: a.name, normalBalance: a.normalBalance, isHeader: !!a.isHeader });
  }
  for (const a of data.extraAccounts) index.set(a.code, { code: a.code, name: a.name, normalBalance: a.normalBalance, isHeader: false });
  return index;
}

/** Target balance per account as debit minus credit (positive = net debit). Unknown accounts are skipped; validateData reports them. */
export function targetNet(data: ParsedData, index: Map<string, AccountInfo>): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  for (const t of data.trial) {
    const acct = index.get(t.accountCode);
    if (!acct) continue;
    let net: Prisma.Decimal;
    if (t.amount !== undefined) net = acct.normalBalance === "DEBIT" ? t.amount : t.amount.neg();
    else net = (t.debit ?? ZERO).sub(t.credit ?? ZERO);
    out.set(t.accountCode, (out.get(t.accountCode) ?? ZERO).add(net));
  }
  return out;
}

const SAVING_ACCOUNT: Record<string, string> = { POKOK: "3-1000", WAJIB: "3-1100", SUKARELA: "2-1000" };

export function validateData(data: ParsedData): { issues: MigrationIssue[]; totals: MigrationTotals } {
  const issues: MigrationIssue[] = [];
  const err = (sheet: string, row: number | null, column: string | null, message: string) =>
    issues.push({ severity: "error", sheet, row, column, message });
  const warn = (sheet: string, row: number | null, column: string | null, message: string) =>
    issues.push({ severity: "warning", sheet, row, column, message });

  const cutoff = data.koperasi.cutoffDate;
  const unitCodes = new Set<string>();
  for (const u of data.units) {
    if (unitCodes.has(u.unitCode)) err("2_Unit", u._row, "unitCode", `Kode unit ganda: ${u.unitCode}`);
    unitCodes.add(u.unitCode);
  }
  const unitRef = (sheet: string, row: number, code?: string) => {
    if (code && !unitCodes.has(code)) err(sheet, row, "unitCode", `Kode unit ${code} tidak ada di 2_Unit`);
  };

  const niks = new Map<string, number>();
  for (const m of data.members) {
    if (niks.has(m.nik)) err("3_Anggota", m._row, "nik", `NIK ganda (juga di baris ${niks.get(m.nik)})`);
    niks.set(m.nik, m._row);
    unitRef("3_Anggota", m._row, m.unitCode);
  }

  const savingTypeByCode = new Map<string, string>();
  for (const p of data.savingProducts) {
    if (savingTypeByCode.has(p.code)) err("4_Produk_Simpanan", p._row, "code", `Kode produk ganda: ${p.code}`);
    savingTypeByCode.set(p.code, p.type);
    try {
      validateRegulatoryRate("SAVING", p.rate);
    } catch (e) {
      err("4_Produk_Simpanan", p._row, "rate", (e as Error).message);
    }
  }
  const loanProducts = new Map(data.loanProducts.map((p) => [p.code, p]));
  for (const p of data.loanProducts) {
    try {
      validateRegulatoryRate("LOAN", p.rate);
      assertFrequencyMethodCompatible(p);
    } catch (e) {
      err("6_Produk_Pinjaman", p._row, "rate", (e as Error).message);
    }
  }

  const pokokNik = new Set<string>();
  const seenSaving = new Set<string>();
  const savingByType: Record<string, Prisma.Decimal> = { POKOK: ZERO, WAJIB: ZERO, SUKARELA: ZERO };
  for (const s of data.savings) {
    if (!niks.has(s.nik)) err("5_Saldo_Simpanan", s._row, "nik", `NIK ${maskNik(s.nik)} tidak ada di 3_Anggota`);
    const type = savingTypeByCode.get(s.productCode);
    if (!type) err("5_Saldo_Simpanan", s._row, "productCode", `Kode produk ${s.productCode} tidak ada di 4_Produk_Simpanan`);
    if (s.balance.isNeg()) err("5_Saldo_Simpanan", s._row, "balance", "Saldo tidak boleh negatif");
    const key = `${s.nik}|${s.productCode}`;
    if (seenSaving.has(key)) err("5_Saldo_Simpanan", s._row, "productCode", "Pasangan NIK dan kode produk ganda");
    seenSaving.add(key);
    unitRef("5_Saldo_Simpanan", s._row, s.unitCode);
    if (type) {
      savingByType[type] = savingByType[type]!.add(s.balance);
      if (type === "POKOK") pokokNik.add(s.nik);
    }
  }

  const loanRefs = new Set<string>();
  const memberByNik = new Map(data.members.map((m) => [m.nik, m]));
  let principalSum = ZERO;
  const pengurusPrincipal = new Map<string, Prisma.Decimal>();
  for (const l of data.loans) {
    if (loanRefs.has(l.loanRef)) err("7_Pinjaman", l._row, "loanRef", `Kode pinjaman ganda: ${l.loanRef}`);
    loanRefs.add(l.loanRef);
    if (!niks.has(l.nik)) err("7_Pinjaman", l._row, "nik", `NIK ${maskNik(l.nik)} tidak ada di 3_Anggota`);
    else if (!pokokNik.has(l.nik)) err("7_Pinjaman", l._row, "nik", "Anggota belum punya simpanan pokok di 5_Saldo_Simpanan");
    if (!loanProducts.has(l.productCode)) err("7_Pinjaman", l._row, "productCode", `Kode produk ${l.productCode} tidak ada di 6_Produk_Pinjaman`);
    if (l.remainingPrincipal.gt(l.remainingAmount)) err("7_Pinjaman", l._row, "remainingPrincipal", "Sisa pokok melebihi sisa kewajiban");
    if (l.remainingAmount.gt(l.totalAmount)) err("7_Pinjaman", l._row, "remainingAmount", "Sisa kewajiban melebihi total kewajiban awal");
    if (l.status === "COMPLETED" && !l.remainingAmount.isZero()) err("7_Pinjaman", l._row, "status", "Pinjaman COMPLETED harus bersisa 0");
    if (l.status !== "COMPLETED" && l.remainingPrincipal.lte(0)) err("7_Pinjaman", l._row, "remainingPrincipal", "Pinjaman berjalan harus punya sisa pokok > 0");
    if (l.disbursedAt > cutoff) err("7_Pinjaman", l._row, "disbursedAt", "Tanggal cair melewati tanggal cut-off");
    unitRef("7_Pinjaman", l._row, l.unitCode);
    principalSum = principalSum.add(l.remainingPrincipal);
    const m = memberByNik.get(l.nik);
    if (m && (m.isPengurus || m.isPengawas)) {
      pengurusPrincipal.set(l.nik, (pengurusPrincipal.get(l.nik) ?? ZERO).add(l.principalAmount));
    }
    if (l.estimated) warn("7_Pinjaman", l._row, null, "Tenor, tanggal cair, dan plafon adalah estimasi dari laporan.");
  }
  const modal = data.koperasi.modalDisetor;
  if (modal && !modal.isZero()) {
    for (const [nik, sum] of pengurusPrincipal) {
      if (sum.gt(modal.mul("0.1"))) {
        warn("7_Pinjaman", null, "principalAmount", `Pinjaman pengurus/pengawas NIK ${maskNik(nik)} melebihi 10% Modal Disetor (Permenkop UKM 8/2023)`);
      }
    }
  }

  // Schedule (SISTEM): the unpaid principal of each loan must equal its remainingPrincipal.
  const byLoan = new Map<string, typeof data.schedule>();
  for (const s of data.schedule) {
    if (!loanRefs.has(s.loanRef)) {
      err("8_Jadwal_Angsuran", s._row, "loanRef", `Kode pinjaman ${s.loanRef} tidak ada di 7_Pinjaman`);
      continue;
    }
    byLoan.set(s.loanRef, [...(byLoan.get(s.loanRef) ?? []), s]);
  }
  for (const [ref, rows] of byLoan) {
    const seqs = rows.map((r) => r.seq).sort((a, b) => a - b);
    if (seqs.some((q, i) => q !== i + 1)) err("8_Jadwal_Angsuran", rows[0]!._row, "seq", `Angsuran ${ref} harus berurutan 1..n tanpa lompat atau ganda`);
    const loan = data.loans.find((l) => l.loanRef === ref)!;
    const owed = rows.reduce((a, r) => a.add(r.principalDue.sub(r.principalPaid)), ZERO);
    if (!owed.eq(loan.remainingPrincipal)) {
      err("8_Jadwal_Angsuran", rows[0]!._row, "principalDue", `Sisa pokok jadwal ${owed} tidak sama dengan sisa pokok pinjaman ${loan.remainingPrincipal}`);
    }
    for (const r of rows) {
      if (r.principalPaid.gt(r.principalDue) || r.interestPaid.gt(r.interestDue)) err("8_Jadwal_Angsuran", r._row, "principalPaid", "Terbayar melebihi tagihan");
    }
  }

  // Trial balance / neraca.
  const index = accountIndex(data);
  const sheet = data.mode === "SISTEM" ? "9_Saldo_Awal_Jurnal" : "9_Neraca";
  for (const t of data.trial) {
    const acct = index.get(t.accountCode);
    if (!acct) err(sheet, t._row, "accountCode", `Akun ${t.accountCode} tidak ada di COA standar atau 10_Akun_Tambahan`);
    else if (acct.isHeader) err(sheet, t._row, "accountCode", `Akun ${t.accountCode} adalah akun induk dan tidak bisa dijurnal`);
    if (data.mode === "SISTEM" && t.debit && t.credit && !t.debit.isZero() && !t.credit.isZero()) {
      err(sheet, t._row, "debit", "Isi salah satu: debit atau kredit");
    }
    if (t.unitCode) warn(sheet, t._row, "unitCode", "Kolom unitCode diabaikan; saldo awal diposting di tingkat koperasi.");
  }
  const target = targetNet(data, index);
  let debit = ZERO;
  let credit = ZERO;
  for (const v of target.values()) {
    if (v.gte(0)) debit = debit.add(v);
    else credit = credit.add(v.neg());
  }
  if (!debit.eq(credit)) err(sheet, null, null, `Neraca saldo tidak seimbang: debit ${debit} kredit ${credit} (selisih ${debit.sub(credit)})`);

  for (const [type, code] of Object.entries(SAVING_ACCOUNT)) {
    const sub = savingByType[type]!;
    const gl = (target.get(code) ?? ZERO).neg();
    if (!sub.isZero() && !sub.eq(gl)) {
      warn(sheet, null, null, `Rekonsiliasi: total simpanan ${type} di 5_Saldo_Simpanan ${sub} berbeda dari akun ${code} di sheet 9 (${gl})`);
    }
  }
  const piutang = target.get("1-1100") ?? ZERO;
  if (!principalSum.isZero() && !principalSum.eq(piutang)) {
    warn(sheet, null, null, `Rekonsiliasi: total sisa pokok pinjaman ${principalSum} berbeda dari akun 1-1100 di sheet 9 (${piutang})`);
  }

  return {
    issues,
    totals: {
      members: data.members.length,
      savingAccounts: data.savings.length,
      savingBalanceByType: Object.fromEntries(Object.entries(savingByType).map(([k, v]) => [k, v.toString()])),
      loans: data.loans.length,
      loanRemainingPrincipal: principalSum.toString(),
      trialDebit: debit.toString(),
      trialCredit: credit.toString()
    }
  };
}
