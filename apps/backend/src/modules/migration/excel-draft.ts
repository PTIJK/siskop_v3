import ExcelJS from "exceljs";
import {
  EXCEL_IMPORT_GROUPS,
  type ExcelBalanceDates,
  type ExcelImportData,
  type ExcelImportField,
  type ExcelImportGroup,
  type ExcelImportRecord,
  type ExcelImportSummary
} from "@siskop/types";
import { dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { checkWorkbookArchive, invalidWorkbook } from "./excel-draft-archive.js";

const MAX_RECORDS = 20_000;
const MAX_FIELDS = 80;
const MAX_TEXT = 300;
const FIELD_BUDGET = 8_000_000;
type Group = Exclude<ExcelImportGroup, "lainnya">;
type Header = { label: string; key: string; saving: boolean; loan: boolean; charge: boolean; finance: boolean };
type Cell = { column: number; value: string | number; unresolved: boolean; formula: boolean };

function key(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

const names = /^(?:nama(?: lengkap| anggota| pegawai| karyawan| nasabah| peminjam| anggota koperasi)?|full name|member name|name)$/;
const identifiers = /^(?:nik(?: anggota)?|no(?:mor)? (?:anggota|ang gota|induk anggota|ktp|pegawai)|id anggota|kode anggota|member (?:id|no)|legacy no|nip|nrp)$/;
const nik = /^(?:nik(?: anggota)?|no(?:mor)? ktp)$/;
const amount = /^(?:saldo(?: awal| akhir)?|balance|amount|jumlah|nominal|nilai|debi[td]|kredit|credit)(?: \d{4})?$/;
const total = /^(?:sub ?total|grand total|total(?: keseluruhan)?|jumlah)(?:\s|$)/i;
const ordinal = /^(?:no|nomor|urut|no urut)$/;
const accountNames = /^(?:nama akun|account name|report name|rekening|nama rekening|nama bank|uraian|keterangan|akun|pos)(?: |$)/;
const fieldLabels: Record<string, string> = {
  "no ang gota": "No. Anggota",
  "legacy no": "Nomor anggota lama",
  "full name": "Nama anggota",
  "birth place": "Tempat lahir",
  "birth date": "Tanggal lahir",
  "is active": "Aktif",
  "is pengurus": "Pengurus",
  "is pengawas": "Pengawas",
  occupation: "Pekerjaan",
  address: "Alamat",
  nik: "NIK",
  balance: "Saldo",
  amount: "Jumlah",
  "account name": "Nama akun",
  "account code": "Kode akun",
  "report name": "Nama akun",
  "product code": "Kode produk",
  "unit code": "Kode unit",
  "loan ref": "Kode pinjaman",
  "principal amount": "Pokok awal",
  "total amount": "Total kewajiban",
  "remaining amount": "Sisa kewajiban",
  "remaining principal": "Sisa pokok",
  "term months": "Tenor (bulan)",
  "installment amount": "Angsuran per periode",
  "installment count": "Jumlah angsuran",
  "installment frequency": "Frekuensi angsuran",
  "disbursed at": "Tanggal cair",
  "due date": "Jatuh tempo",
  "principal due": "Pokok tagihan",
  "principal paid": "Pokok terbayar",
  "interest due": "Bunga tagihan",
  "interest paid": "Bunga terbayar",
  "rate type": "Jenis imbalan",
  rate: "Tarif"
};

function sheetGroup(name: string): Group | undefined {
  const normalized = key(name);
  if (/\b(?:neraca|saldo awal jurnal|posisi keuangan|balance sheet)\b/.test(normalized)) return "neraca";
  if (/\b(?:saldo kas|kas dan bank|kas bank)\b/.test(normalized) || /^(?:\d+ )?(?:kas|bank)$/.test(normalized)) return "kas";
  if (/\b(?:pinjaman|pembiayaan|piutang anggota|loan|loans|jadwal angsuran|kredit anggota)\b/.test(normalized)) return "pinjaman";
  if (/\b(?:simpanan|tabungan|savings|modal)\b/.test(normalized)) return "simpanan";
  if (/\b(?:anggota|members|keanggotaan)\b/.test(normalized)) return "anggota";
  return undefined;
}

function describe(label: string, group?: Group): Header {
  const normalized = key(label);
  const charge = /\b(?:infaq|infak|bunga|interest|margin|marjin|ujrah|imbalan?|bagi hasil|jasa(?: pinjaman| pembiayaan)?|profit sharing|service fee)\b/.test(normalized);
  const saving = !charge && (
    /\b(?:simpanan|tabungan|savings|sukarela|wajib|qurban|kurban)\b/.test(normalized) ||
    (group === "simpanan" && /\b(?:pokok|modal)\b/.test(normalized))
  );
  const loan = /\b(?:pinjaman|pembiayaan|angsuran|outstanding|plafon|loan|cicilan|piutang|principal)\b/.test(normalized) ||
    /^(?:pokok awal|sisa pokok|sisa kewajiban|total kewajiban|remaining amount|remaining principal|total amount|tenor|termin|jml bulan|jumlah bulan)(?: |$)/.test(normalized) ||
    (group === "pinjaman" && normalized === "pokok");
  return { label, key: normalized, loan, saving, charge, finance: amount.test(normalized) || /^(?:saldo kas|saldo bank|kas|bank)$/.test(normalized) };
}

function readCells(row: ExcelJS.Row): Cell[] {
  const cells: Cell[] = [];
  row.eachCell((cell, column) => {
    if (column > MAX_FIELDS) return;
    const value = cell.value;
    const formula = cell.type === ExcelJS.ValueType.Formula;
    const result = formula ? cell.result : value;
    if ((result && typeof result === "object" && "error" in result) || (formula && result == null)) {
      cells.push({ column, value: "", unresolved: true, formula });
      return;
    }
    if (result == null) return;
    const content = result instanceof Date ? (Number.isFinite(result.getTime()) ? result.toISOString().slice(0, 10) : "")
      : typeof result === "number" && Number.isFinite(result) ? result
      : typeof result === "object" && "richText" in result ? result.richText.map((t) => t.text).join("")
      : formula ? String(result) : cell.text;
    const normalized = typeof content === "string" ? content.replaceAll("\0", "").trim() : content;
    if (normalized !== "") cells.push({ column, value: normalized, unresolved: false, formula });
  });
  return cells;
}

function titleField(header: Header, group: ExcelImportGroup) {
  if (group === "neraca" || group === "kas") return accountNames.test(header.key);
  return names.test(header.key);
}

function financialValue(header: Header, group: ExcelImportGroup) {
  const label = key(header.label);
  if (/\b(?:no|nomor|nama|kode|jenis|tipe|type|code|name|status|tanggal|date|ref|tenor|periode|frekuensi|jumlah angsuran|jml bulan|jumlah bulan)\b/.test(label)) return false;
  if (/%/.test(header.label) || /\b(?:persen|tarif|rate|suku)\b/.test(label)) return false;
  if (group === "lainnya" && /^shu |^total shu$/.test(label)) return true;
  if (group === "anggota" || group === "lainnya") return false;
  return header.finance || header.loan || header.saving || header.charge || /^pokok(?: |$)/.test(label);
}

function recordsFor(cells: Cell[], headers: Map<number, Header>, hint: Group | undefined, sheet: string) {
  const labeled = cells.flatMap((c) => {
    const header = headers.get(c.column);
    return header ? [{ ...c, header }] : [];
  });
  const groups: ExcelImportGroup[] = [];
  const productSheet = /\bproduk\b/.test(key(sheet));
  if (/\b(?:shu|arus kas|rugi laba|laba rugi|inventaris)\b/.test(key(sheet)) || key(sheet) === "master") groups.push("lainnya");
  else if (hint === "kas" || hint === "neraca") groups.push(hint);
  else {
    if (hint === "anggota" || (!hint && labeled.some(({ header }) => names.test(header.key) || identifiers.test(header.key)))) groups.push("anggota");
    if (hint === "simpanan" || (!productSheet && labeled.some(({ header }) => header.saving))) groups.push("simpanan");
    if (hint === "pinjaman" || (!productSheet && labeled.some(({ header }) => header.loan || (header.charge && hint !== "simpanan")))) groups.push("pinjaman");
  }
  if (groups.length === 0) groups.push("lainnya");

  const identity = labeled.some(({ header, unresolved, value }) => !unresolved &&
    (names.test(header.key) || (identifiers.test(header.key) && (!nik.test(header.key) || (typeof value === "string" && /^\d{16}$/.test(value))))));
  return groups.map((group) => {
    let title = "";
    let reference = "";
    const fields: ExcelImportField[] = [];
    const notes = new Set<string>();
    for (const cell of cells) {
      const { column, unresolved, formula, value } = cell;
      const header = headers.get(column);
      if (groups.length > 1 && header && !names.test(header.key) && !identifiers.test(header.key)) {
        if (group === "anggota" && (header.saving || header.loan || header.charge || header.finance)) continue;
        if (group === "simpanan" && header.loan && !header.saving) continue;
        if (group === "pinjaman" && header.saving && !header.loan) continue;
      }
      if (header && ordinal.test(header.key)) continue;
      if (unresolved) {
        notes.add("Ada nilai yang belum tersedia dari Excel.");
        continue;
      }
      if (formula) notes.add("Ada nilai dari hasil rumus tersimpan. Periksa apakah masih sesuai.");
      const isNik = !!header && nik.test(header.key);
      if (isNik && (typeof value !== "string" || !/^\d{16}$/.test(value))) {
        notes.add("NIK perlu diperiksa. Gunakan 16 digit dalam format teks di Excel.");
        if (typeof value === "string" && /^(?:TMP|SRC)-[A-Z0-9-]+$/i.test(value)) {
          fields.push({ label: "Referensi anggota", value: value.slice(0, MAX_TEXT), kind: "text" });
        }
        continue;
      }
      if (header && titleField(header, group) && !title) {
        title = String(value).slice(0, MAX_TEXT);
        continue;
      }
      if (header && !reference && !isNik && (identifiers.test(header.key) || /^(?:kode akun|account code|loan ref|kode pinjaman|kode produk|product code)$/.test(header.key))) {
        reference = String(value).slice(0, MAX_TEXT);
      }
      if (typeof value === "string" && value.length > MAX_TEXT) notes.add("Ada teks panjang yang dipotong di draf ini.");
      fields.push({
        label: header ? fieldLabels[header.key] ?? header.label : "Keterangan",
        value: typeof value === "string" ? value.slice(0, MAX_TEXT) : value,
        kind: isNik ? "nik" as const : header && financialValue(header, group) ? "money" as const : "text" as const
      });
    }
    if (group !== "lainnya" && !headers.size) notes.add("Judul data belum dikenali.");
    if (group === "anggota" && [...headers.values()].some((header) => nik.test(header.key)) &&
        !labeled.some(({ header }) => nik.test(header.key))) notes.add("NIK belum tersedia.");
    if (!identity && !productSheet && headers.size && (group === "anggota" || group === "simpanan" || group === "pinjaman")) {
      notes.add(group === "anggota" ? "Identitas anggota belum ditemukan." : "Anggota untuk data ini belum diketahui.");
    }
    return {
      group,
      record: { title: title || reference || (group === "lainnya" ? sheet : "Data tanpa nama"),
        ...(title && group !== "neraca" && group !== "kas" ? { memberName: title } : {}), sheet, fields, notes: [...notes] }
    };
  });
}

// Stacked savings headings put the product above its year columns and total.
function savingsHeadings(worksheet: ExcelJS.Worksheet, row: number, column: number, label: string) {
  const below = (offset: number, col: number) => worksheet.getRow(row + offset).getCell(col).text.trim();
  const years = (offset: number, col: number) => /^20\d{2}$/.test(below(offset, col)) && /^20\d{2}$/.test(below(offset, col + 1));
  if (/^simpanan pokok wajib$/.test(key(label)) && years(1, column) && /^(?:jumlah|total)$/.test(key(below(1, column + 2)))) {
    return {
      depth: 1,
      labels: [label + " · " + below(1, column), label + " · " + below(1, column + 1), "Total " + label]
    };
  }
  if (/^simpanan sukarela modal dan tab qurban$/.test(key(label)) &&
      key(below(1, column)) === "modal" && key(below(1, column + 1)) === "tabungan sukarela" &&
      key(below(1, column + 4)) === "tabungan qurban" && years(2, column + 1) && years(2, column + 4)) {
    return {
      depth: 2,
      labels: [
        "Modal",
        "Tabungan Sukarela · " + below(2, column + 1), "Tabungan Sukarela · " + below(2, column + 2), "Total Tabungan Sukarela",
        "Tabungan Qurban · " + below(2, column + 4), "Tabungan Qurban · " + below(2, column + 5), "Total Tabungan Qurban",
        "Jumlah"
      ]
    };
  }
  return undefined;
}

function mergeSavingsStatements(records: ExcelImportRecord[], statements: ExcelImportRecord[]) {
  const byMember = new Map<string, ExcelImportRecord[]>();
  for (const record of statements) {
    const memberNo = record.fields.find((field) => /^(?:no|nomor) anggota$/.test(key(field.label)))?.value;
    if (memberNo === undefined || record.title === "Data tanpa nama") continue;
    const identity = JSON.stringify([String(memberNo), key(record.title)]);
    const matches = byMember.get(identity) ?? [];
    matches.push(record);
    byMember.set(identity, matches);
  }
  const redundant = new Set<ExcelImportRecord>();
  for (const matches of byMember.values()) {
    const [first, second] = matches;
    if (matches.length !== 2 || !first || !second || first.sheet === second.sheet) continue;
    const nextFields = second.fields.filter((field) => !first.fields.some((existing) =>
      existing.label === field.label && String(existing.value) === String(field.value) && existing.kind === field.kind));
    if (nextFields.some((field) => first.fields.some((existing) => existing.label === field.label))) continue;
    first.fields.push(...nextFields);
    first.notes = [...new Set([...first.notes, ...second.notes])];
    first.sheet += " · " + second.sheet;
    redundant.add(second);
  }
  return records.filter((record) => !redundant.has(record));
}

const monthNames = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];

function balanceDate(value: string): string | undefined {
  const phrase = /(?:^|\b)(?:per(?: tanggal)?|saldo per|cut[\s-]*off|tanggal saldo(?: awal)?)\s*:?\s*(.*)/i.exec(value)?.[1]?.trim();
  if (!phrase) return undefined;
  const iso = /^(\d{4}-\d{2}-\d{2})\b/.exec(phrase)?.[1];
  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/.exec(phrase);
  const named = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/i.exec(phrase);
  const month = named ? monthNames.indexOf(named[2]!.toLowerCase().replace("nopember", "november")) + 1 : 0;
  const date = iso ?? (numeric ? numeric[3] + "-" + numeric[2]!.padStart(2, "0") + "-" + numeric[1]!.padStart(2, "0") :
    named && month ? named[3] + "-" + String(month).padStart(2, "0") + "-" + named[1]!.padStart(2, "0") : "");
  const parsed = parseDateKey(date);
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === date ? date : undefined;
}

export async function readExcelDraft(buffer: Buffer): Promise<{ records: ExcelImportData; counts: ExcelImportSummary["counts"]; balanceDates: ExcelBalanceDates; limited: boolean }> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS expands named ranges into cells; the draft only needs sheet values.
  Object.defineProperty(workbook.definedNames, "model", { value: [], writable: true });
  try {
    checkWorkbookArchive(buffer);
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer, {
      ignoreNodes: ["mergeCells", "dataValidations", "conditionalFormatting", "cols", "hyperlinks", "drawing", "tableParts", "extLst"]
    });
  } catch {
    throw invalidWorkbook();
  }
  if (workbook.worksheets.length === 0) throw invalidWorkbook();
  const records: ExcelImportData = { anggota: [], simpanan: [], pinjaman: [], neraca: [], kas: [], lainnya: [] };
  let limited = false;
  let recordCount = 0;
  let remaining = FIELD_BUDGET;
  const savingsStatements: ExcelImportRecord[] = [];
  const dates = { simpanan: new Set<string>(), pinjaman: new Set<string>() };

  for (const worksheet of workbook.worksheets) {
    const sheet = worksheet.name.replaceAll("\0", "");
    if (/^(?:petunjuk|referensi)\b/.test(key(sheet))) continue;
    const hint = sheetGroup(sheet);
    let headers = new Map<number, Header>();
    let headerEnd = 0;
    let numberedMemberList = false;
    let afterTotal = false;
    let savingsStatement = false;
    const beforeHeader: Cell[][] = [];
    const capture = (cells: Cell[]) => {
      for (const { group, record } of recordsFor(cells, headers, hint, sheet)) {
        if (!record.fields.length && !record.notes.length && record.title === "Data tanpa nama") continue;
        remaining -= Buffer.byteLength(JSON.stringify(record));
        if (recordCount >= MAX_RECORDS || remaining < 0) {
          limited = true;
          return;
        }
        records[group].push(record);
        if (group === "simpanan" && savingsStatement) savingsStatements.push(record);
        recordCount++;
      }
    };
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerEnd) return;
      if (limited && (recordCount >= MAX_RECORDS || remaining < 0)) return;
      const cells = readCells(row);
      if (rowNumber <= 15 && (hint === "simpanan" || hint === "pinjaman")) {
        const text = cells.filter((cell) => !cell.unresolved).map((cell) => cell.value).join(" ");
        const date = balanceDate(text);
        if (date) dates[hint].add(date);
      }
      if (row.cellCount > MAX_FIELDS) limited = true;
      if (!cells.length || String(cells[0]?.value).startsWith("#")) return;
      const first = cells[0];
      if (numberedMemberList && first && typeof first.value === "string" &&
          /^(?:total|jumlah|grand total)$/.test(key(first.value)) && cells.some((cell) => typeof cell.value === "number")) {
        afterTotal = true;
        return;
      }
      const labels = cells.filter((c): c is Cell & { value: string } => typeof c.value === "string" && !c.unresolved && !c.formula)
        .map((c) => [c.column, describe(c.value.slice(0, MAX_TEXT), hint)] as const);
      const recognized = labels.filter(([, h]) => names.test(h.key) || identifiers.test(h.key) || h.saving || h.loan || h.charge || h.finance ||
        ((hint === "kas" || hint === "neraca") && accountNames.test(h.key)) ||
        /^(?:account code|kode akun|kode produk|product code|nama produk|alamat|tanggal lahir|tempat lahir|jenis kelamin|tanggal masuk|pekerjaan|telepon|no hp)(?: |$)/.test(h.key));
      const memberHeader = recognized.some(([, h]) => /^(?:nama anggota(?: koperasi)?|full name|member name)$/.test(h.key));
      const hasMemberName = recognized.some(([, h]) => names.test(h.key));
      if (afterTotal && !(hasMemberName && labels.some(([, h]) => ordinal.test(h.key)))) return;
      if ((recognized.length >= 2 || memberHeader) && labels.length === cells.length) {
        headers = new Map(labels);
        numberedMemberList = hasMemberName && labels.some(([, h]) => ordinal.test(h.key));
        afterTotal = false;
        savingsStatement = false;
        if (hint === "simpanan") {
          for (const [column, header] of labels) {
            if (!header.saving) continue;
            const stack = savingsHeadings(worksheet, rowNumber, column, header.label);
            if (!stack) continue;
            stack.labels.forEach((label, index) => headers.set(column + index, describe(label, hint)));
            headerEnd = rowNumber + stack.depth;
            savingsStatement = true;
            break;
          }
        }
        if (hint === "pinjaman" && numberedMemberList) {
          const stacks = labels.filter(([, h]) => /^pembiayaan [12]$/.test(h.key));
          for (const [column, header] of stacks) {
            const children = [0, 1, 2, 3].map((i) => worksheet.getRow(rowNumber + 1).getCell(column + i).text.trim());
            if (children.map(key).join("|") !== "jml bulan|pokok|infaq|jumlah") continue;
            children.forEach((child, i) => headers.set(column + i, describe(header.label + " · " + child, hint)));
            headerEnd = rowNumber + 1;
          }
        }
        return;
      }
      if (!headers.size) {
        // This also retains sheets with no recognizable headings for manual review.
        if (beforeHeader.length < 12) beforeHeader.push(cells);
        else {
          capture(beforeHeader.shift()!);
          beforeHeader.push(cells);
        }
        return;
      }
      const firstText = cells.find((c) => typeof c.value === "string" && c.value)?.value;
      if (typeof firstText === "string" && total.test(firstText) && cells.some((c) => typeof c.value === "number") &&
          (hint !== "neraca" && hint !== "kas")) return;
      capture(cells);
    });
    if (!headers.size) beforeHeader.forEach(capture);
    if (recordCount >= MAX_RECORDS || remaining < 0) break;
  }
  records.simpanan = mergeSavingsStatements(records.simpanan, savingsStatements);
  const counts = Object.fromEntries(EXCEL_IMPORT_GROUPS.map((group) => [group, records[group].length])) as ExcelImportSummary["counts"];
  const balanceDates: ExcelBalanceDates = {};
  for (const group of ["simpanan", "pinjaman"] as const) {
    if (dates[group].size === 1) balanceDates[group] = [...dates[group]][0];
  }
  return { records, counts, balanceDates, limited };
}
