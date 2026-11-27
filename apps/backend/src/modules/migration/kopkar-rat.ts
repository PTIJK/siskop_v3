import ExcelJS from "exceljs";
import { z } from "zod";
import { ErrorCode, KOPKAR_RAT_TENANT_ID, type KopkarRatArchive, type KopkarRatFileKind, type KopkarRatRow, type ProvisionalMember } from "@siskop/types";
import { db, type TxClient } from "../../lib/db.js";
import { AppError, forbidden } from "../../lib/errors.js";

export const kopkarRatQuery = z.object({
  kind: z.enum(["prepared_review", "original_master", "original_template"]).default("prepared_review"),
  sheet: z.string().min(1).max(31).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1)
}).strict();

type ArchiveFile = KopkarRatArchive["files"][number] & {
  workbook: Uint8Array | null;
  reviewNotes: { sheet: string; row: number; note: string }[] | null;
};

function cellText(cell: ExcelJS.Cell): string | null {
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if ("formula" in value || "sharedFormula" in value) {
    const result = cell.result;
    return result == null ? `=${cell.formula}` : `=${cell.formula} → ${cell.text}`;
  }
  return cell.text;
}

const financeSheets = new Set(["5_Saldo_Simpanan", "7_Pinjaman", "8_Jadwal_Angsuran", "9_Neraca", "9_Saldo_Awal_Jurnal"]);
const sourceFinanceSheets = new Set(["Simpanan Anggota", "Modal SR TQ", "Pembiayaan", "Neraca"]);
const masterBalances = [7, 11, 12, 14, 17, 20, 24];

const readArchive = (kind: KopkarRatFileKind, tx: TxClient = db) =>
  tx.$queryRaw<ArchiveFile[]>`SELECT * FROM public.read_kopkar_rat_archive(${kind}::text)`;

export async function getKopkarRatWorkbookFile(kind: KopkarRatFileKind) {
  const file = (await readArchive(kind)).find((entry) => entry.kind === kind);
  if (!file?.workbook) throw new AppError(ErrorCode.NOT_FOUND, "File arsip tidak ditemukan");
  return { name: file.name, bytes: Buffer.from(file.workbook) };
}

const archiveCache = new Map<KopkarRatFileKind, Promise<{ files: KopkarRatArchive["files"]; wb: ExcelJS.Workbook | null; reviewNotes: { sheet: string; row: number; note: string }[] }>>();

async function loadKopkarRat(kind: KopkarRatFileKind, tx: TxClient = db) {
  const useCache = tx === db && process.env.NODE_ENV !== "test";
  if (useCache) {
    const cached = archiveCache.get(kind);
    if (cached) return cached;
  }
  const promise = (async () => {
    const archive = await readArchive(kind, tx);
    const files = archive.map(({ kind, name, sheetCount }) => ({ kind, name, sheetCount }));
    if (!archive.length) return { files, wb: null, reviewNotes: [] };
    const file = archive.find((entry) => entry.kind === kind);
    if (!file?.workbook) throw new AppError(ErrorCode.NOT_FOUND, "File arsip tidak ditemukan");

    // Only the fixed, administrator-loaded Kopkar archive is read by these views.
    if (file.workbook.byteLength > 1024 * 1024) throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File arsip melebihi batas 1 MB");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(file.workbook) as unknown as ExcelJS.Buffer);
    return { files, wb, reviewNotes: file.reviewNotes ?? [] };
  })();
  if (useCache) {
    archiveCache.set(kind, promise);
    promise.then((res) => { if (!res.wb) archiveCache.delete(kind); }, () => archiveCache.delete(kind));
  }
  return promise;
}

export async function listProvisionalKopkarMembers(tenantId: string, tx: TxClient = db): Promise<ProvisionalMember[]> {
  if (tenantId !== KOPKAR_RAT_TENANT_ID) throw forbidden("Arsip anggota ini hanya tersedia di Kopkar UM Surabaya.");
  const [{ wb }, published, corrections] = await Promise.all([
    loadKopkarRat("prepared_review", tx),
    tx.kopkarRatPublication.findMany({ where: { tenantId, kind: "member" }, select: { sourceRow: true } }),
    tx.kopkarRatMemberCorrection.findMany({ where: { tenantId }, select: {
      sourceRow: true, fullName: true, nik: true, address: true, birthPlace: true, birthDate: true, occupation: true, revision: true
    } })
  ]);
  if (!wb) return [];
  const activeRows = new Set(published.map((row) => row.sourceRow));
  const correctionsByRow = new Map(corrections.map(({ sourceRow, ...data }) => [sourceRow, data]));
  const ws = wb.getWorksheet("3_Anggota");
  if (!ws) throw new AppError(ErrorCode.NOT_FOUND, "Sheet anggota arsip tidak ditemukan");

  const headers = ws.getRow(1).values as ExcelJS.CellValue[];
  const memberName = headers.indexOf("fullName");
  const reference = headers.indexOf("nik");
  if (memberName < 1 || reference < 1) throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "Kolom sumber anggota tidak lengkap");
  const columns = ["legacyNo", "address", "birthPlace", "birthDate", "occupation"].map((key) => headers.indexOf(key));
  const members: ProvisionalMember[] = [];
  ws.eachRow((row, sourceRow) => {
    if (sourceRow < 4 || activeRows.has(sourceRow)) return;
    const fullName = cellText(row.getCell(memberName))?.trim();
    if (!fullName) return;
    const key = cellText(row.getCell(reference))?.trim() ?? "";
    const temporaryId = /^TMP-\d+$/.test(key) ? key : /^SRC-\d+$/.test(key) ? `TMP-${key}` : `TMP-ROW-${sourceRow}`;
    const [legacyNo = null, address = null, birthPlace = null, birthDate = null, occupation = null] = columns.map((index) =>
      index > 0 ? cellText(row.getCell(index))?.trim() || null : null);
    members.push({ temporaryId, sourceRow, fullName, legacyNo, nik: null, address, birthPlace, birthDate, occupation, revision: 0, ...correctionsByRow.get(sourceRow) });
  });
  return members;
}

export async function readKopkarRat({ kind, sheet: requested, page }: z.infer<typeof kopkarRatQuery>): Promise<KopkarRatArchive> {
  const { files, wb, reviewNotes } = await loadKopkarRat(kind);
  if (!wb) return { files, sheet: null };
  const ws = requested ? wb.getWorksheet(requested) : wb.getWorksheet("3_Anggota") ?? wb.getWorksheet("master") ?? wb.worksheets[0];
  if (!ws) throw new AppError(ErrorCode.NOT_FOUND, "Sheet arsip tidak ditemukan");

  const notesByRow = new Map<number, string[]>();
  for (const note of reviewNotes) {
    if (note.sheet !== ws.name) continue;
    const notes = notesByRow.get(note.row) ?? [];
    notes.push(note.note);
    notesByRow.set(note.row, notes);
  }
  const sourceName = ws.name.replace(/^Sumber_/, "");
  const sourceMaster = sourceName === "master";
  const memberName = ws.name === "3_Anggota"
    ? (ws.getRow(1).values as ExcelJS.CellValue[]).indexOf("fullName")
    : 0;
  const limit = 50;
  let total = 0;
  const rows: KopkarRatRow[] = [];
  ws.eachRow((row, number) => {
    const index = total++;
    if (index < (page - 1) * limit || index >= page * limit) return;
    const first = cellText(row.getCell(1));
    const dataRow = number >= 4 && !!first && !first.trimStart().startsWith("#");
    const masterRow = sourceMaster && number >= 3 && number < 790 && !!cellText(row.getCell(3));
    const flags: KopkarRatRow["flags"] = [];
    if ((number >= 4 && memberName > 0 && !!cellText(row.getCell(memberName))) || (masterRow && ![721, 730, 753, 789].includes(number))) flags.push("missing_nik");
    const cells = Array.from({ length: row.cellCount }, (_, i) => cellText(row.getCell(i + 1)));
    const sourceAmount = number >= 3 && sourceFinanceSheets.has(sourceName) && cells.some((cell, index) =>
      index >= 3 && cell !== null && (cell.startsWith("=") || /^-?\d+(?:\.\d+)?$/.test(cell)));
    if ((dataRow && financeSheets.has(ws.name)) || sourceAmount || (masterRow && masterBalances.some((col) => cells[col - 1] != null))) flags.push("unverified_balance");
    rows.push({ row: number, cells, flags, notes: notesByRow.get(number) ?? [] });
  });
  return { files, sheet: { kind, names: wb.worksheets.map((sheet) => sheet.name), name: ws.name, page, limit, total, rows } };
}

const publishSheets = { member: "3_Anggota", saving: "5_Saldo_Simpanan", loan: "7_Pinjaman" } as const;

export async function loadRatPublishSource() {
  const { wb, reviewNotes } = await loadKopkarRat("prepared_review");
  if (!wb) throw new AppError(ErrorCode.NOT_FOUND, "Arsip RAT Kopkar tidak ditemukan");
  function rows(kind: keyof typeof publishSheets) {
    const name = publishSheets[kind];
    const sheet = wb!.getWorksheet(name);
    if (!sheet) return [];
    const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
    const referenceColumn = headers.indexOf(kind === "loan" ? "loanRef" : "nik");
    const ownerColumn = headers.indexOf("nik");
    const nameColumn = headers.indexOf("fullName");
    const amountColumn = headers.indexOf(kind === "loan" ? "remainingPrincipal" : "balance");
    const fieldNames = kind === "saving" ? ["balance"] : kind === "loan"
      ? ["remainingPrincipal", "remainingAmount", "termMonths", "installmentAmount", "kolCategory"] : [];
    const fieldColumns = fieldNames.map((field) => [field, headers.indexOf(field)] as const);
    const productColumn = headers.indexOf("productCode");
    const notesByRow = new Map<number, string[]>();
    for (const note of reviewNotes.filter((entry) => entry.sheet === name)) {
      const list = notesByRow.get(note.row) ?? [];
      list.push(note.note);
      notesByRow.set(note.row, list);
    }
    const result: { sourceRow: number; reference: string; ownerRef: string; name: string; value: string | null; productRef: string; sourceFields: Record<string, string>; notes: string[] }[] = [];
    if (referenceColumn < 1 || ownerColumn < 1) return result;
    sheet.eachRow((row, sourceRow) => {
      if (sourceRow < 4) return;
      const reference = cellText(row.getCell(referenceColumn))?.trim();
      const ownerRef = cellText(row.getCell(ownerColumn))?.trim();
      if (!reference || !ownerRef || reference.startsWith("#")) return;
      result.push({
        sourceRow, reference, ownerRef,
        name: nameColumn > 0 ? cellText(row.getCell(nameColumn)) ?? "" : "",
        value: amountColumn > 0 ? cellText(row.getCell(amountColumn)) : null,
        productRef: productColumn > 0 ? cellText(row.getCell(productColumn))?.trim() ?? "" : "",
        sourceFields: Object.fromEntries(fieldColumns.flatMap(([field, column]) => {
          const value = column > 0 ? cellText(row.getCell(column)) : null;
          return value === null ? [] : [[field, value]];
        })),
        notes: notesByRow.get(sourceRow) ?? []
      });
    });
    return result;
  }
  const neraca = wb.getWorksheet("9_Neraca");
  const headers = neraca?.getRow(1).values as ExcelJS.CellValue[] | undefined;
  const accountCode = headers?.indexOf("accountCode") ?? -1;
  const amount = headers?.indexOf("amount") ?? -1;
  const loanNeraca: (string | null)[] = [];
  if (accountCode > 0 && amount > 0) {
    neraca?.eachRow((row, number) => {
      if (number >= 4 && cellText(row.getCell(accountCode))?.trim() === "1-1100") loanNeraca.push(cellText(row.getCell(amount)));
    });
  }
  return { member: rows("member"), saving: rows("saving"), loan: rows("loan"), loanNeraca };
}
