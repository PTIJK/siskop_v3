import { db } from "../../lib/db.js";
import { validationError } from "../../lib/errors.js";
import { businessDate, dateKey } from "../../lib/operating-calendar.js";
import { getPerubahanEkuitas } from "./capital-service.js";
import { MAX_EXPORT_ROWS, type ExportColumn, type ExportRow, type ExportSheet } from "./export.js";
import { getBukuBesar, getBukuBesarAccount, getJurnal, getNeracaSaldo, type BookPeriod, type UnitScope } from "./ledger-service.js";
import { getArusKas, getLaporanHasilUsaha, getNeraca, getShuDistribution } from "./regulatory-service.js";

/** Reports that can be exported; each maps onto an on-screen report with the same name. */
export const EXPORT_REPORTS = [
  "neraca",
  "laporan-hasil-usaha",
  "arus-kas",
  "perubahan-ekuitas",
  "shu-distribution",
  "jurnal-umum",
  "jurnal-penyesuaian",
  "neraca-saldo",
  "buku-besar"
] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];

/** Reports that read the ledger books and therefore understand the "unallocated" unit scope. */
export const BOOK_REPORTS: readonly ExportReport[] = ["jurnal-umum", "jurnal-penyesuaian", "neraca-saldo", "buku-besar"];

export interface ExportRequest {
  tenantId: string;
  unit: UnitScope;
  period: BookPeriod;
  /** Neraca is cumulative to one date: the period's end. */
  asOf: Date;
  /** Buku Besar for one account instead of the overview. */
  accountId?: string;
}

const day = (d: Date) => dateKey(businessDate(d));

async function labels(req: ExportRequest, title: string, range: string) {
  const [tenant, unit] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: req.tenantId }, select: { name: true } }),
    typeof req.unit === "string" ? db.cooperativeUnit.findFirst({ where: { id: req.unit, tenantId: req.tenantId }, select: { name: true } }) : null
  ]);
  const scope = req.unit === null ? "Tidak dialokasikan ke unit" : unit ? unit.name : "Semua unit (konsolidasi)";
  return { tenantName: tenant.name, title, subtitle: `${range} · ${scope}` };
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const longDate = (key: string) => {
  const [y = "", m = "1", d = "1"] = key.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const rangeText = (from: string, to: string) => (from === to ? longDate(from) : `${longDate(from)} s/d ${longDate(to)}`);

const text = (key: string, header: string, width?: number): ExportColumn => ({ key, header, kind: "text", width });
const money = (key: string, header: string): ExportColumn => ({ key, header, kind: "money" });

const CODE_NAME_AMOUNT = (amountHeader: string): ExportColumn[] => [
  text("code", "Kode", 12),
  text("name", "Nama Akun", 44),
  money("amount", amountHeader)
];

/** Stops a runaway export before the file is built, with a message the user can act on. */
function assertWithinLimit(rows: number) {
  if (rows > MAX_EXPORT_ROWS) {
    throw validationError(`Terlalu banyak baris (${rows}); persempit periode atau pilih satu unit agar di bawah ${MAX_EXPORT_ROWS} baris`);
  }
}

async function neraca(req: ExportRequest): Promise<ExportSheet> {
  const data = await getNeraca(req.tenantId, req.asOf, req.unit === null ? undefined : req.unit);
  const rows: ExportRow[] = [];
  const section = (title: string, s: typeof data.aset, subtotal?: { label: string; amount: string }) => {
    rows.push({ cells: { name: title.toUpperCase() }, style: "section" });
    for (const i of s.items) rows.push({ cells: { code: i.code, name: i.name, amount: i.balance }, indent: i.level - 1, style: i.isHeader ? "subtotal" : undefined });
    if (subtotal) rows.push({ cells: { name: subtotal.label, amount: subtotal.amount } });
    rows.push({ cells: { name: `Total ${title}`, amount: s.total }, style: "total" });
  };
  section("Aset", data.aset);
  section("Kewajiban", data.kewajiban);
  section("Ekuitas", data.ekuitas, { label: "Modal Sendiri (pokok, wajib, modal tetap, cadangan, hibah)", amount: data.modalSendiri });
  rows.push({ cells: { name: "Total Kewajiban dan Ekuitas", amount: data.totalKewajibanDanEkuitas }, style: "total" });
  return { name: "Neraca", ...(await labels(req, "Neraca", `Per ${longDate(data.asOfDate)}`)), columns: CODE_NAME_AMOUNT("Saldo"), rows };
}

async function hasilUsaha(req: ExportRequest): Promise<ExportSheet> {
  const data = await getLaporanHasilUsaha(req.tenantId, req.period.start, req.period.end, req.unit === null ? undefined : req.unit);
  const rows: ExportRow[] = [];
  const section = (title: string, s: typeof data.pendapatan) => {
    rows.push({ cells: { name: title.toUpperCase() }, style: "section" });
    for (const i of s.items) rows.push({ cells: { code: i.code, name: i.name, amount: i.total }, indent: i.level - 1, style: i.isHeader ? "subtotal" : undefined });
    rows.push({ cells: { name: `Total ${title}`, amount: s.total }, style: "total" });
  };
  section("Pendapatan", data.pendapatan);
  section("Beban", data.beban);
  rows.push({ cells: { name: "SHU Berjalan (Pendapatan − Beban)", amount: data.shuBerjalan }, style: "total" });
  const range = rangeText(data.periode.from, data.periode.to);
  return { name: "Hasil Usaha", ...(await labels(req, "Laporan Hasil Usaha", range)), columns: CODE_NAME_AMOUNT("Jumlah"), rows };
}

async function arusKas(req: ExportRequest): Promise<ExportSheet> {
  const data = await getArusKas(req.tenantId, req.period.start, req.period.end, req.unit === null ? undefined : req.unit);
  const columns = [text("label", "Keterangan", 52), money("amount", "Jumlah")];
  const rows: ExportRow[] = [];
  if (data.catatan) {
    rows.push({ cells: { label: data.catatan } });
  } else {
    rows.push({ cells: { label: "Saldo Kas Awal", amount: data.saldoKasAwal }, style: "subtotal" });
    for (const [title, s] of [
      ["Aktivitas Operasi", data.aktivitasOperasi],
      ["Aktivitas Investasi", data.aktivitasInvestasi],
      ["Aktivitas Pendanaan", data.aktivitasPendanaan]
    ] as const) {
      rows.push({ cells: { label: title.toUpperCase() }, style: "section" });
      for (const r of s.rincian) rows.push({ cells: { label: r.label, amount: r.amount }, indent: 1 });
      rows.push({ cells: { label: `Total ${title}`, amount: s.total }, style: "total" });
    }
    rows.push({ cells: { label: "Kenaikan (Penurunan) Kas Bersih", amount: data.kenaikanPenurunanKasBersih }, style: "subtotal" });
    rows.push({ cells: { label: "Saldo Kas Akhir", amount: data.saldoKasAkhir }, style: "total" });
  }
  return { name: "Arus Kas", ...(await labels(req, "Laporan Arus Kas", rangeText(data.periode.from, data.periode.to))), columns, rows };
}

async function perubahanEkuitas(req: ExportRequest): Promise<ExportSheet> {
  const data = await getPerubahanEkuitas(req.tenantId, req.period.start, req.period.end, req.unit === null ? undefined : req.unit);
  const columns = [text("label", "Keterangan", 36), ...data.columns.map((c) => money(c.key, c.label)), money("total", "Total")];
  const rows: ExportRow[] = data.rows.map((r) => ({
    cells: {
      label: r.label,
      ...Object.fromEntries(data.columns.map((c) => [c.key, r.values[c.key] ?? "0"])),
      total: r.total
    },
    style: r.key === "SALDO_AWAL" || r.key === "SALDO_AKHIR" ? "total" : undefined
  }));
  return { name: "Perubahan Ekuitas", ...(await labels(req, "Laporan Perubahan Ekuitas", rangeText(data.periode.from, data.periode.to))), columns, rows };
}

async function shuDistribution(req: ExportRequest): Promise<ExportSheet> {
  const data = await getShuDistribution(req.tenantId, req.period.start, req.period.end);
  const columns: ExportColumn[] = [
    { key: "no", header: "No", kind: "int", width: 6 },
    text("memberCode", "No Anggota", 16),
    text("fullName", "Nama", 34),
    money("pokok", "SHU Pokok/SW"),
    money("sukarela", "SHU Sukarela"),
    money("pinjaman", "SHU Pinjaman"),
    money("total", "Total SHU")
  ];
  const rows: ExportRow[] = data.catatan
    ? [{ cells: { fullName: data.catatan } }]
    : data.anggota.map((a) => ({
        cells: { no: a.no, memberCode: a.memberCode, fullName: a.fullName, pokok: a.shuPokokWajib, sukarela: a.shuSukarela, pinjaman: a.jasaPinjaman, total: a.totalShu }
      }));
  if (!data.catatan && data.totalDibagikanKeAnggota) rows.push({ cells: { fullName: "Total Dibagikan ke Anggota", total: data.totalDibagikanKeAnggota }, style: "total" });
  return { name: "Pembagian SHU", ...(await labels({ ...req, unit: undefined }, "Pembagian SHU", rangeText(data.periode.from, data.periode.to))), columns, rows };
}

async function jurnal(req: ExportRequest, adjustmentsOnly: boolean): Promise<ExportSheet> {
  const columns: ExportColumn[] = [
    { key: "no", header: "No", kind: "int", width: 8 },
    { key: "date", header: "Tanggal", kind: "date" },
    text("code", "Kode", 12),
    text("account", "Nama Akun", 36),
    text("description", "Keterangan", 44),
    text("type", "Jenis", 14),
    text("source", "Sumber", 24),
    money("debit", "Debit"),
    money("credit", "Kredit")
  ];
  const rows: ExportRow[] = [];
  const PAGE = 1000;
  let totals = { debit: "0", credit: "0" };
  for (let page = 1; ; page++) {
    const { report, total } = await getJurnal(req.tenantId, {
      period: req.period,
      unit: req.unit,
      entryType: adjustmentsOnly ? "PENYESUAIAN" : undefined,
      page,
      limit: PAGE
    });
    assertWithinLimit(total);
    totals = { debit: report.totalDebit, credit: report.totalCredit };
    for (const r of report.rows) {
      rows.push({
        cells: { no: r.entryNo, date: r.entryDate, code: r.accountCode, account: r.accountName, description: r.description, type: r.entryType, source: r.sourceType, debit: r.debit, credit: r.credit }
      });
    }
    if (page * PAGE >= total) break;
  }
  rows.push({ cells: { description: "Total", debit: totals.debit, credit: totals.credit }, style: "total" });
  const title = adjustmentsOnly ? "Jurnal Penyesuaian" : "Jurnal Umum";
  return { name: title, ...(await labels(req, title, rangeText(day(req.period.start), day(req.period.end)))), columns, rows };
}

const TRIAL_COLUMNS: ExportColumn[] = [
  text("code", "Kode", 12),
  text("name", "Nama Akun", 44),
  money("awal", "Saldo Awal"),
  money("debit", "Debit"),
  money("credit", "Kredit"),
  money("akhir", "Saldo Akhir")
];

async function trialBalance(req: ExportRequest, overview: boolean): Promise<ExportSheet> {
  const data = overview ? await getBukuBesar(req.tenantId, req.period, req.unit) : await getNeracaSaldo(req.tenantId, req.period, req.unit);
  const rows: ExportRow[] = data.rows.map((r) => ({
    cells: { code: r.code, name: r.name, awal: r.saldoAwal, debit: r.mutasiDebit, credit: r.mutasiKredit, akhir: r.saldoAkhir },
    indent: r.level - 1,
    style: r.isHeader ? "subtotal" : undefined
  }));
  rows.push({ cells: { name: "Total", debit: data.totals.mutasiDebit, credit: data.totals.mutasiKredit }, style: "total" });
  const title = overview ? "Buku Besar" : "Neraca Saldo";
  return { name: title, ...(await labels(req, title, rangeText(data.periode.from, data.periode.to))), columns: TRIAL_COLUMNS, rows };
}

async function bukuBesarAccount(req: ExportRequest, accountId: string): Promise<ExportSheet> {
  const columns: ExportColumn[] = [
    { key: "no", header: "No", kind: "int", width: 8 },
    { key: "date", header: "Tanggal", kind: "date" },
    text("description", "Keterangan", 52),
    money("debit", "Debit"),
    money("credit", "Kredit"),
    money("saldo", "Saldo")
  ];
  const rows: ExportRow[] = [];
  const PAGE = 1000;
  let head: Awaited<ReturnType<typeof getBukuBesarAccount>>["report"] | null = null;
  for (let page = 1; ; page++) {
    const { report, total } = await getBukuBesarAccount(req.tenantId, accountId, req.period, req.unit, page, PAGE);
    assertWithinLimit(total);
    head = report;
    if (page === 1) rows.push({ cells: { description: "Saldo awal", saldo: report.saldoAwal }, style: "subtotal" });
    for (const l of report.lines) {
      rows.push({ cells: { no: l.entryNo, date: l.entryDate, description: l.description, debit: l.debit, credit: l.credit, saldo: l.saldo } });
    }
    if (page * PAGE >= total) break;
  }
  rows.push({ cells: { description: "Total periode / saldo akhir", debit: head.totalDebit, credit: head.totalCredit, saldo: head.saldoAkhir }, style: "total" });
  const title = `Buku Besar: ${head.account.code} ${head.account.name}`;
  return { name: `BB ${head.account.code}`, ...(await labels(req, title, rangeText(head.periode.from, head.periode.to))), columns, rows };
}

export function buildExport(report: ExportReport, req: ExportRequest): Promise<ExportSheet> {
  switch (report) {
    case "neraca":
      return neraca(req);
    case "laporan-hasil-usaha":
      return hasilUsaha(req);
    case "arus-kas":
      return arusKas(req);
    case "perubahan-ekuitas":
      return perubahanEkuitas(req);
    case "shu-distribution":
      return shuDistribution(req);
    case "jurnal-umum":
      return jurnal(req, false);
    case "jurnal-penyesuaian":
      return jurnal(req, true);
    case "neraca-saldo":
      return trialBalance(req, false);
    case "buku-besar":
      return req.accountId ? bukuBesarAccount(req, req.accountId) : trialBalance(req, true);
  }
}

/** Download filename stem: the report plus its period (or as-of date). */
export function exportFilenameStem(report: ExportReport, req: ExportRequest): string {
  if (report === "neraca") return `neraca-${day(req.asOf)}`;
  const account = report === "buku-besar" && req.accountId ? `-${req.accountId.slice(-6)}` : "";
  return `${report}${account}-${day(req.period.start)}_${day(req.period.end)}`;
}
