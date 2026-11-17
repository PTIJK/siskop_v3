import ExcelJS from "exceljs";
import { z } from "zod";
import { ErrorCode, type KopkarRatArchive, type KopkarRatRow } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";

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

export async function readKopkarRat({ kind, sheet: requested, page }: z.infer<typeof kopkarRatQuery>): Promise<KopkarRatArchive> {
  const archive = await db.$queryRaw<ArchiveFile[]>`SELECT * FROM public.read_kopkar_rat_archive(${kind}::text)`;
  const files = archive.map(({ kind, name, sheetCount }) => ({ kind, name, sheetCount }));
  if (!archive.length) return { files, sheet: null };
  const file = archive.find((entry) => entry.kind === kind);
  if (!file?.workbook) throw new AppError(ErrorCode.NOT_FOUND, "File arsip tidak ditemukan");

  // Only the fixed, administrator-loaded Kopkar archive is read by this endpoint.
  if (file.workbook.byteLength > 1024 * 1024) throw new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File arsip melebihi batas 1 MB");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(file.workbook) as unknown as ExcelJS.Buffer);
  const ws = requested ? wb.getWorksheet(requested) : wb.getWorksheet("3_Anggota") ?? wb.getWorksheet("master") ?? wb.worksheets[0];
  if (!ws) throw new AppError(ErrorCode.NOT_FOUND, "Sheet arsip tidak ditemukan");

  const notesByRow = new Map<number, string[]>();
  for (const note of file.reviewNotes ?? []) {
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
