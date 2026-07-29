/**
 * One-off migration: loads the RAT (Rapat Anggota Tahunan) 2025 book-closing
 * data for Koperasi Karyawan dan Dosen Universitas Muhammadiyah Surabaya (a
 * syariah cooperative) into a brand-new SISKOP tenant.
 *
 * Source: apps/backend/scripts/data/kopkar-umsurabaya-2025/*.csv — real RAT
 * export files, gitignored (never committed). Run this from the repo with
 * that directory present.
 *
 * Design (see the approved plan for full rationale):
 *  - Structural setup (tenant, COA, mappings, SavingConfig/LoanConfig) is
 *    created directly via Prisma, mirroring prisma/seed.ts's seedAccounting().
 *  - Members and Savings are created through the REAL service-layer functions
 *    (members/service.ts, savings/service.ts) — same validation/id-generation/
 *    journal-posting logic production traffic uses.
 *  - Financing (Pembiayaan) rows are the one case with no equivalent "opening
 *    balance" API: the CSV only gives each loan's *current remaining* state,
 *    not its original principal/term/disbursement date, so the LoanConfig-rate
 *    forward calculation `createLoan()` always performs can't reproduce it.
 *    Loans are inserted directly with their already-known values and posted
 *    via the exported `postLoanDisbursement()` from lib/journal.ts — the same
 *    posting helper `createLoan()` itself uses, just skipping the forward calc.
 *  - A single dated "Saldo Migrasi" journal entry plugs Kas/Piutang Macet/
 *    Aset Tetap/SHU Tahun Lalu to the real closing balances from neraca.csv,
 *    balanced against Cadangan — mirrors the precedent already in
 *    prisma/seed.ts's own "Setoran modal awal" opening entry.
 *
 * Run: pnpm --filter backend exec tsx scripts/import-kopkar-umsurabaya.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/lib/db.js";
import { registerTenant } from "../src/modules/auth/service.js";
import { createMember } from "../src/modules/members/service.js";
import { createSaving } from "../src/modules/savings/service.js";
import { postLoanDisbursement } from "../src/lib/journal.js";
import { getDefaultUnitId } from "../src/lib/units.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data", "kopkar-umsurabaya-2025");

const TENANT_SLUG = "kopkar-umsurabaya";
const TENANT_NAME = "Koperasi Karyawan dan Dosen Universitas Muhammadiyah Surabaya";
const ADMIN_EMAIL = `admin@${TENANT_SLUG}.local`;
const ADMIN_PASSWORD = "Migrasi2025!";
/** Migration cutover date — when this data was recorded in SISKOP, not a claim about real disbursement/join dates. */
const CUTOVER_DATE = new Date("2025-12-31");

// ── CSV parsing ──────────────────────────────────────────────────────────────

/** Minimal RFC4180-ish CSV parser: handles quoted fields with embedded commas/quotes. */
function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsvRows(filename: string): string[][] {
  const raw = readFileSync(path.join(DATA_DIR, filename), "utf-8");
  return parseCsv(raw);
}

/** A data row's first column ("No") is a plain integer — filters out headers, blanks, "Total", and the signature block. */
function isDataRow(row: string[]): boolean {
  return /^\d+$/.test((row[0] ?? "").trim());
}

function findTotalRow(rows: string[][]): string[] | undefined {
  return rows.find((r) => (r[0] ?? "").trim().toLowerCase() === "total");
}

/**
 * Parses an Indonesian Rupiah cell into a non-negative-or-negative integer.
 * Handles both the "nil" convention ("Rp-", "Rp -   ") and true negatives
 * ("-Rp 4,385,000.00", where the sign precedes "Rp"), with or without cents.
 */
function rupiah(cell: string | undefined): number {
  if (cell == null) return 0;
  const s = cell.trim();
  if (s === "") return 0;
  const isNegative = s.startsWith("-");
  const withoutCurrency = s.replace(/Rp/gi, "");
  const numeric = withoutCurrency.replace(/,/g, "").trim();
  const digitsOnly = numeric.replace(/[^0-9.]/g, "");
  if (!digitsOnly || digitsOnly === ".") return 0;
  const intPart = digitsOnly.split(".")[0];
  if (!intPart) return 0;
  const value = Number(intPart);
  if (Number.isNaN(value)) return 0;
  return isNegative ? -value : value;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── Source rows ──────────────────────────────────────────────────────────────

interface SimpananRow {
  nama: string;
  jumlah: number;
}
function parseSimpanan(): { rows: SimpananRow[]; totalRow?: string[] } {
  const raw = readCsvRows("simpanan-2025.csv");
  const rows = raw
    .filter(isDataRow)
    .map((r) => ({ nama: (r[2] ?? "").trim(), jumlah: rupiah(r[5]) }));
  return { rows, totalRow: findTotalRow(raw) };
}

interface ShuRow {
  nama: string;
  shuPokokSW: number;
  shuSukarela: number;
  shuPinjaman: number;
  totalShu: number;
}
function parseShuDistribusi(): ShuRow[] {
  return readCsvRows("shu-distribusi-2025.csv")
    .filter(isDataRow)
    .map((r) => ({
      nama: (r[2] ?? "").trim(),
      shuPokokSW: rupiah(r[3]),
      shuSukarela: rupiah(r[4]),
      shuPinjaman: rupiah(r[5]),
      totalShu: rupiah(r[6])
    }));
}

interface ModalRow {
  nama: string;
  modal: number;
  tabunganSukarelaTotal: number;
  tabunganQurbanTotal: number;
}
const NON_MEMBER_NAMES = new Set(["kopkar", "bunga admin dan pajak bank jatim"].map(normalizeName));
function parseModal(): { rows: ModalRow[]; totalRow?: string[] } {
  const raw = readCsvRows("modal-2025.csv");
  const rows = raw.filter(isDataRow).map((r) => ({
    nama: (r[2] ?? "").trim(),
    modal: rupiah(r[3]),
    tabunganSukarelaTotal: rupiah(r[6]),
    tabunganQurbanTotal: rupiah(r[9])
  }));
  return { rows, totalRow: findTotalRow(raw) };
}

interface PembiayaanEntry {
  jmlBulan: number;
  pokok: number;
  infaq: number;
}
interface PembiayaanRow {
  nama: string;
  loan1?: PembiayaanEntry;
  loan2?: PembiayaanEntry;
}
function parsePembiayaan(): { rows: PembiayaanRow[]; totalRow?: string[] } {
  const raw = readCsvRows("pembiayaan-2025.csv");
  const rows = raw.filter(isDataRow).map((r) => {
    const jmlBulan1 = parseInt((r[3] ?? "").trim(), 10);
    const jmlBulan2 = parseInt((r[7] ?? "").trim(), 10);
    const loan1 =
      Number.isFinite(jmlBulan1) && jmlBulan1 > 0
        ? { jmlBulan: jmlBulan1, pokok: rupiah(r[4]), infaq: rupiah(r[5]) }
        : undefined;
    const loan2 =
      Number.isFinite(jmlBulan2) && jmlBulan2 > 0
        ? { jmlBulan: jmlBulan2, pokok: rupiah(r[8]), infaq: rupiah(r[9]) }
        : undefined;
    return { nama: (r[2] ?? "").trim(), loan1, loan2 };
  });
  return { rows, totalRow: findTotalRow(raw) };
}

// ── Structural setup (direct Prisma — mirrors prisma/seed.ts) ────────────────

interface AccountSeed {
  key: string;
  code: string;
  name: string;
  category: "ASET" | "KEWAJIBAN" | "EKUITAS" | "PENDAPATAN" | "BEBAN";
  normalBalance: "DEBIT" | "KREDIT";
  isCashEquivalent?: boolean;
}

const COA_TEMPLATE: AccountSeed[] = [
  { key: "kas", code: "1-1000", name: "Kas / Bank Jatim", category: "ASET", normalBalance: "DEBIT", isCashEquivalent: true },
  { key: "piutang_pembiayaan", code: "1-1100", name: "Piutang Pembiayaan Anggota", category: "ASET", normalBalance: "DEBIT" },
  { key: "piutang_macet", code: "1-1150", name: "Piutang Pembiayaan Macet", category: "ASET", normalBalance: "DEBIT" },
  { key: "aset_tetap_inventaris", code: "1-2000", name: "Aset Tetap — Inventaris", category: "ASET", normalBalance: "DEBIT" },
  { key: "simpanan_sukarela", code: "2-1000", name: "Simpanan Sukarela — Anggota", category: "KEWAJIBAN", normalBalance: "KREDIT" },
  { key: "simpanan_pokok_wajib", code: "3-1000", name: "Simpanan Pokok & Wajib", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "cadangan", code: "3-2000", name: "Cadangan / Modal Penyertaan Koperasi", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "shu_lalu", code: "3-3100", name: "SHU Tahun Lalu Belum Dibagi", category: "EKUITAS", normalBalance: "KREDIT" },
  { key: "pendapatan_infaq", code: "4-1000", name: "Pendapatan Infaq / Margin Pembiayaan", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "pendapatan_lain", code: "4-9000", name: "Pendapatan Lain-lain", category: "PENDAPATAN", normalBalance: "KREDIT" },
  { key: "beban_bagi_hasil_simpanan", code: "5-1000", name: "Beban Bagi Hasil Simpanan", category: "BEBAN", normalBalance: "DEBIT" }
];

async function seedChartOfAccounts(tenantId: string) {
  const accountIdByKey = new Map<string, string>();
  for (const acc of COA_TEMPLATE) {
    const created = await db.account.create({
      data: {
        tenantId,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        normalBalance: acc.normalBalance,
        isCashEquivalent: acc.isCashEquivalent ?? false,
        isDefault: true,
        isActive: true
      }
    });
    accountIdByKey.set(acc.key, created.id);
  }
  return accountIdByKey;
}

async function upsertMapping(
  tenantId: string,
  sourceType: "SAVING_CONFIG" | "LOAN_CONFIG",
  sourceId: string,
  transactionKind: "DEPOSIT" | "WITHDRAWAL" | "DISBURSEMENT" | "PAYMENT_PRINCIPAL" | "PAYMENT_INTEREST" | "PAYMENT_PENALTY",
  debitAccountId: string,
  creditAccountId: string
) {
  await db.accountMapping.create({
    data: { tenantId, sourceType, sourceId, transactionKind, debitAccountId, creditAccountId }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const existing = await db.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (existing) {
    console.error(
      `Tenant "${TENANT_SLUG}" already exists (id ${existing.id}). Delete it first if you want to re-run this import.`
    );
    process.exit(1);
  }

  console.log(`Parsing source CSVs from ${DATA_DIR} ...`);
  const simpanan = parseSimpanan();
  const shu = parseShuDistribusi();
  const modal = parseModal();
  const pembiayaan = parsePembiayaan();

  const shuByName = new Map(shu.map((r) => [normalizeName(r.nama), r]));
  const modalByName = new Map<string, ModalRow>();
  for (const r of modal.rows) {
    const key = normalizeName(r.nama);
    if (NON_MEMBER_NAMES.has(key)) {
      console.log(`  [skip:non-member] modal.csv row "${r.nama}" excluded (not a cooperative member)`);
      continue;
    }
    modalByName.set(key, r);
  }
  const pembiayaanByName = new Map(pembiayaan.rows.map((r) => [normalizeName(r.nama), r]));

  const rosterKeys = new Set(simpanan.rows.map((r) => normalizeName(r.nama)));
  for (const r of modal.rows) {
    const key = normalizeName(r.nama);
    if (!NON_MEMBER_NAMES.has(key) && !rosterKeys.has(key)) {
      console.warn(`  [unmatched] modal.csv "${r.nama}" not found in Simpanan.csv roster — skipped`);
    }
  }
  for (const r of pembiayaan.rows) {
    if (!rosterKeys.has(normalizeName(r.nama))) {
      console.warn(`  [unmatched] pembiayaan.csv "${r.nama}" not found in Simpanan.csv roster — skipped`);
    }
  }
  for (const r of shu) {
    if (!rosterKeys.has(normalizeName(r.nama))) {
      console.warn(`  [unmatched] shu-distribusi.csv "${r.nama}" not found in Simpanan.csv roster — skipped`);
    }
  }

  console.log(`Roster: ${simpanan.rows.length} members from Simpanan.csv`);

  console.log(`\nProvisioning tenant "${TENANT_NAME}" (${TENANT_SLUG}) ...`);
  const session = await registerTenant({
    tenantName: TENANT_NAME,
    slug: TENANT_SLUG,
    registrationNo: "BELUM-TERDAFTAR-KOPKAR-UMSURABAYA",
    address: "Alamat lengkap belum dilengkapi, Surabaya, Jawa Timur",
    type: "SYARIAH",
    adminName: "Administrator Sistem",
    adminEmail: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    firstUnit: { type: "KSP", name: "Simpan Pinjam Syariah" }
  });
  const tenantId = session.user.tenantId;
  const adminUserId = session.user.id;
  const unitId = await getDefaultUnitId(tenantId);

  console.log("Seeding Chart of Accounts ...");
  const acc = await seedChartOfAccounts(tenantId);

  console.log("Creating SavingConfigs ...");
  const savingConfigPokokWajib = await db.savingConfig.create({
    data: { tenantId, name: "Simpanan Pokok & Wajib", type: "POKOK", rateType: "BAGI_HASIL", rate: 0, periodUnit: "MONTHLY", isActive: true }
  });
  const savingConfigModal = await db.savingConfig.create({
    data: { tenantId, name: "Modal Penyertaan", type: "SUKARELA", rateType: "BAGI_HASIL", rate: 0, periodUnit: "YEARLY", isActive: true }
  });
  const savingConfigTabSukarela = await db.savingConfig.create({
    data: { tenantId, name: "Tabungan Sukarela", type: "SUKARELA", rateType: "BAGI_HASIL", rate: 0, periodUnit: "YEARLY", isActive: true }
  });
  const savingConfigTabQurban = await db.savingConfig.create({
    data: { tenantId, name: "Tabungan Qurban", type: "SUKARELA", rateType: "BAGI_HASIL", rate: 0, periodUnit: "YEARLY", isActive: true }
  });

  console.log("Creating LoanConfig ...");
  const loanConfig = await db.loanConfig.create({
    data: { tenantId, name: "Pembiayaan Anggota (Murabahah)", type: "SYARIAH", rateType: "MARGIN", rate: 10, maxTermMonths: 96, isActive: true }
  });

  console.log("Wiring AccountMappings ...");
  const kas = acc.get("kas")!;
  const piutang = acc.get("piutang_pembiayaan")!;
  const pendapatanInfaq = acc.get("pendapatan_infaq")!;
  const pendapatanLain = acc.get("pendapatan_lain")!;
  const simpananPokokWajibAcc = acc.get("simpanan_pokok_wajib")!;
  const simpananSukarelaAcc = acc.get("simpanan_sukarela")!;

  await upsertMapping(tenantId, "SAVING_CONFIG", savingConfigPokokWajib.id, "DEPOSIT", kas, simpananPokokWajibAcc);
  await upsertMapping(tenantId, "SAVING_CONFIG", savingConfigPokokWajib.id, "WITHDRAWAL", simpananPokokWajibAcc, kas);
  for (const cfg of [savingConfigModal, savingConfigTabSukarela, savingConfigTabQurban]) {
    await upsertMapping(tenantId, "SAVING_CONFIG", cfg.id, "DEPOSIT", kas, simpananSukarelaAcc);
    await upsertMapping(tenantId, "SAVING_CONFIG", cfg.id, "WITHDRAWAL", simpananSukarelaAcc, kas);
  }
  await upsertMapping(tenantId, "LOAN_CONFIG", loanConfig.id, "DISBURSEMENT", piutang, kas);
  await upsertMapping(tenantId, "LOAN_CONFIG", loanConfig.id, "PAYMENT_PRINCIPAL", kas, piutang);
  await upsertMapping(tenantId, "LOAN_CONFIG", loanConfig.id, "PAYMENT_INTEREST", kas, pendapatanInfaq);
  await upsertMapping(tenantId, "LOAN_CONFIG", loanConfig.id, "PAYMENT_PENALTY", kas, pendapatanLain);

  console.log("Seeding ShuDistributionConfig (7-bucket policy folded into the system's 4 buckets — see presentase-shu-2025.csv) ...");
  await db.shuDistributionConfig.create({
    data: { tenantId, jasaSimpananPercent: 30, jasaPinjamanPercent: 30, cadanganPercent: 10, lainnyaPercent: 30 }
  });

  // ── Members, Savings, Pembiayaan ────────────────────────────────────────────

  let nikSeq = 1;
  let importedPokokWajib = 0;
  let importedModal = 0;
  let importedTabSukarela = 0;
  let importedTabQurban = 0;
  let importedPembiayaanPrincipal = 0;
  let loanCount = 0;

  console.log(`\nImporting ${simpanan.rows.length} members ...`);
  for (const [index, s] of simpanan.rows.entries()) {
    const key = normalizeName(s.nama);
    const nik = `35${String(nikSeq++).padStart(14, "0")}`;

    const member = await createMember(tenantId, {
      fullName: s.nama,
      nik,
      address: "Data alamat belum dilengkapi — Surabaya",
      birthPlace: "Surabaya",
      birthDate: "1990-01-01",
      occupation: "Karyawan/Dosen UM Surabaya"
    });

    // Every member gets a Pokok/Wajib saving row (even if 0) so the POKOK-type
    // saving invariant financing depends on always holds.
    await createSaving(tenantId, { memberId: member.id, savingConfigId: savingConfigPokokWajib.id, initialDeposit: s.jumlah }, adminUserId);
    importedPokokWajib += s.jumlah;

    const m = modalByName.get(key);
    if (m) {
      if (m.modal > 0) {
        await createSaving(tenantId, { memberId: member.id, savingConfigId: savingConfigModal.id, initialDeposit: m.modal }, adminUserId);
        importedModal += m.modal;
      }
      if (m.tabunganSukarelaTotal > 0) {
        await createSaving(
          tenantId,
          { memberId: member.id, savingConfigId: savingConfigTabSukarela.id, initialDeposit: m.tabunganSukarelaTotal },
          adminUserId
        );
        importedTabSukarela += m.tabunganSukarelaTotal;
      }
      if (m.tabunganQurbanTotal > 0) {
        await createSaving(
          tenantId,
          { memberId: member.id, savingConfigId: savingConfigTabQurban.id, initialDeposit: m.tabunganQurbanTotal },
          adminUserId
        );
        importedTabQurban += m.tabunganQurbanTotal;
      }
    }

    const p = pembiayaanByName.get(key);
    if (p) {
      for (const entry of [p.loan1, p.loan2]) {
        if (!entry) continue;
        const principalAmount = entry.pokok * entry.jmlBulan; // remaining principal, verified == the CSV's "Jumlah" column
        const monthlyPayment = entry.pokok + entry.infaq;
        const totalAmount = monthlyPayment * entry.jmlBulan;

        await db.$transaction(async (tx) => {
          const loan = await tx.loan.create({
            data: {
              tenantId,
              unitId,
              memberId: member.id,
              loanConfigId: loanConfig.id,
              principalAmount,
              totalAmount,
              termMonths: entry.jmlBulan,
              monthlyPayment,
              remainingAmount: totalAmount,
              status: "ACTIVE",
              kolCategory: "LANCAR",
              disbursedAt: CUTOVER_DATE
            }
          });
          await postLoanDisbursement(tx, {
            tenantId,
            loanId: loan.id,
            loanConfigId: loanConfig.id,
            amount: principalAmount,
            entryDate: CUTOVER_DATE,
            description: "Saldo migrasi pembiayaan per 31 Desember 2025"
          });
        });
        importedPembiayaanPrincipal += principalAmount;
        loanCount++;
      }
    }

    if ((index + 1) % 50 === 0) console.log(`  ... ${index + 1}/${simpanan.rows.length} members imported`);
  }
  console.log(`Done: ${simpanan.rows.length} members, ${loanCount} pembiayaan (financing) records.`);

  // ── Cutover reconciliation entry ────────────────────────────────────────────

  console.log("\nPosting cutover reconciliation entry (Saldo Migrasi per 31 Desember 2025) ...");
  const kasLines = await db.journalLine.findMany({ where: { tenantId, accountId: kas } });
  const currentKas = kasLines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0);

  const TARGET_KAS = 280_654_800;
  const TARGET_PIUTANG_MACET = 164_893_200;
  const TARGET_ASET_TETAP = 2_207_000;
  const TARGET_SHU_LALU = 484_620_400;

  const kasAdjustment = TARGET_KAS - currentKas;
  const lines: Array<{ accountId: string; debit?: number; credit?: number }> = [];
  if (kasAdjustment >= 0) lines.push({ accountId: kas, debit: kasAdjustment });
  else lines.push({ accountId: kas, credit: -kasAdjustment });
  lines.push({ accountId: acc.get("piutang_macet")!, debit: TARGET_PIUTANG_MACET });
  lines.push({ accountId: acc.get("aset_tetap_inventaris")!, debit: TARGET_ASET_TETAP });
  lines.push({ accountId: acc.get("shu_lalu")!, credit: TARGET_SHU_LALU });

  const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
  const plug = totalDebit - totalCredit;
  const cadangan = acc.get("cadangan")!;
  if (plug > 0) lines.push({ accountId: cadangan, credit: plug });
  else if (plug < 0) lines.push({ accountId: cadangan, debit: -plug });

  await db.journalEntry.create({
    data: {
      tenantId,
      entryDate: CUTOVER_DATE,
      sourceType: "MANUAL",
      status: "POSTED",
      description: "Saldo Migrasi per 31 Desember 2025",
      lines: { create: lines.map((l) => ({ tenantId, accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0 })) }
    }
  });

  // ── Reconciliation summary ──────────────────────────────────────────────────

  const totalRupiah = (row: string[] | undefined, index: number) => (row ? rupiah(row[index]) : undefined);
  console.log("\n=== Reconciliation summary ===");
  console.log(`Members imported: ${simpanan.rows.length}`);
  console.log(`Pembiayaan (financing) records: ${loanCount}`);
  console.log("");
  console.log(`Simpanan Pokok & Wajib — imported: ${importedPokokWajib.toLocaleString("id-ID")}`);
  console.log(`  Simpanan.csv Total row (Jumlah):  ${(totalRupiah(simpanan.totalRow, 5) ?? 0).toLocaleString("id-ID")}`);
  console.log(`Modal Penyertaan — imported: ${importedModal.toLocaleString("id-ID")}`);
  console.log(`  modal.csv Total row (Modal):       ${(totalRupiah(modal.totalRow, 3) ?? 0).toLocaleString("id-ID")} (includes excluded/unmatched rows)`);
  console.log(`Tabungan Sukarela — imported: ${importedTabSukarela.toLocaleString("id-ID")}`);
  console.log(`  modal.csv Total row (Total Tab Sukarela): ${(totalRupiah(modal.totalRow, 6) ?? 0).toLocaleString("id-ID")} (includes excluded/unmatched rows)`);
  console.log(`Tabungan Qurban — imported: ${importedTabQurban.toLocaleString("id-ID")}`);
  console.log(`  modal.csv Total row (Total Tab Qurban):   ${(totalRupiah(modal.totalRow, 9) ?? 0).toLocaleString("id-ID")} (includes excluded/unmatched rows)`);
  console.log(`Pembiayaan principal (remaining) — imported: ${importedPembiayaanPrincipal.toLocaleString("id-ID")}`);
  console.log(
    `  pembiayaan.csv Total row (Jumlah1+Jumlah2): ${(
      (totalRupiah(pembiayaan.totalRow, 6) ?? 0) + (totalRupiah(pembiayaan.totalRow, 10) ?? 0)
    ).toLocaleString("id-ID")} (includes unmatched rows)`
  );
  console.log("");
  console.log(`Ledger Kas before cutover plug: ${currentKas.toLocaleString("id-ID")}`);
  console.log(`Cutover plug to Cadangan/Modal Penyertaan: ${plug.toLocaleString("id-ID")}`);
  console.log(`Ledger Kas after cutover plug (target, from neraca.csv): ${TARGET_KAS.toLocaleString("id-ID")}`);
  console.log("");
  console.log("SHU distribution reference (source, not imported — the system computes its own live from the ledger):");
  console.log(`  ${shu.length} members in shu-distribusi-2025.csv`);
  console.log("  Compare against Laporan Regulasi > Pembagian SHU once income/expense activity exists for a period.");
  console.log(shuByName.size > 0 ? "" : "");

  console.log("\n=== Done ===");
  console.log(`Tenant: ${TENANT_NAME}`);
  console.log(`Login:  http://${TENANT_SLUG}.localhost:3000`);
  console.log(`Email:  ${ADMIN_EMAIL}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
  console.log("\nFollow-up needed: every member's NIK/address/birthDate/occupation is a placeholder (see script header) — correct via the Members UI as real data becomes available.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
