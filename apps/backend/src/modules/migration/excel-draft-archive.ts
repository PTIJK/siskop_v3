import { inflateRawSync } from "node:zlib";
import { ErrorCode } from "@siskop/types";
import { AppError } from "../../lib/errors.js";

export function invalidWorkbook() {
  return new AppError(ErrorCode.MIGRATION_FILE_INVALID, "File Excel tidak dapat dibaca atau terlalu besar. Coba simpan ulang sebagai .xlsx atau bagi menjadi beberapa file.");
}

// ExcelJS inflates whole ZIP entries. Check actual expanded sizes before it loads the workbook.
export function checkWorkbookArchive(bytes: Buffer): void {
  if (bytes.length < 22) throw invalidWorkbook();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]), bytes.length - 22);
  if (end < 0 || bytes.readUInt32LE(0) !== 0x04034b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) {
    throw invalidWorkbook();
  }
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt32LE(end + 4) !== 0 || bytes.readUInt16LE(end + 8) !== count ||
      count > 256 || start + bytes.readUInt32LE(end + 12) !== end) throw invalidWorkbook();

  let offset = start;
  let available = 16 * 1024 * 1024;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw invalidWorkbook();
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const expanded = bytes.readUInt32LE(offset + 24);
    const local = bytes.readUInt32LE(offset + 42);
    if (expanded > available || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 ||
        (bytes.readUInt16LE(offset + 8) & 1) !== 0) throw invalidWorkbook();
    const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (data + size > start) throw invalidWorkbook();
    const actual = method === 0 ? size : method === 8
      ? inflateRawSync(bytes.subarray(data, data + size), { maxOutputLength: Math.max(1, expanded) }).length
      : -1;
    if (actual !== expanded) throw invalidWorkbook();
    available -= expanded;
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  if (offset !== end) throw invalidWorkbook();
}
