import { createHash } from "node:crypto";
import type { ExcelApplyGroup, ExcelCorrectionIdentity, ExcelCorrectionLoan, ExcelCorrectionMember, ExcelImportRecord } from "@siskop/types";
import { z } from "zod";
import { businessDate, dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { AppError } from "../../lib/errors.js";
import { createMemberSchema } from "../members/schema.js";
import { validateLoanOpening } from "./kopkar-publish.js";

const id = z.string().min(1).max(64);
const money = z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/, "Gunakan angka tanpa pemisah ribuan.");
export const excelDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const parsed = parseDateKey(v);
  return Number.isFinite(parsed.valueOf()) && dateKey(parsed) === v;
}, "Tanggal tidak valid");
export const excelCorrection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), member: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("link"), memberId: id }).strict(),
    z.object({ mode: z.literal("identity"), identity: createMemberSchema.strict().refine((value) =>
      excelDate.safeParse(value.birthDate).success && value.birthDate <= dateKey(businessDate()), {
      path: ["birthDate"], message: "Tanggal lahir tidak valid."
    }) }).strict()
  ]) }).strict(),
  z.object({ kind: z.literal("saving"), productId: id.optional(), amount: money }).strict(),
  z.object({ kind: z.literal("loan"), productId: id.optional(), contract: z.object({
    contractRef: z.string().trim().min(1).max(64), disbursedAt: excelDate, principalAmount: money, totalAmount: money,
    remainingPrincipal: money, remainingAmount: money, installmentAmount: money, termMonths: z.number().int().min(1).max(360),
    rate: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/),
    schedule: z.array(z.object({ dueDate: excelDate, principal: money, margin: money }).strict()).min(1).max(360)
  }).strict() }).strict()
]);

export type DraftRowCorrection = {
  member?: ExcelCorrectionMember;
  savings?: { slot: string; productId?: string; amount: string }[];
  loan?: { productId?: string; contract: ExcelCorrectionLoan };
};
export type DraftCorrections = Record<string, DraftRowCorrection>;
export const importGroups = ["anggota", "simpanan", "pinjaman"] as const;
export const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const memberNumbers = ["noanggota", "nomoranggota", "idanggota", "kodeanggota", "memberid", "memberno", "nomor anggota lama"];

export function field(record: ExcelImportRecord, ...labels: string[]) {
  const keys = labels.map(normalize);
  const values = new Set(record.fields.filter((item) => keys.includes(normalize(item.label))).map((item) => String(item.value).trim()));
  return values.size === 1 ? [...values][0]! : "";
}

export function memberNumber(record: ExcelImportRecord) {
  return field(record, ...memberNumbers);
}

export function sourceMemberName(record: ExcelImportRecord) {
  const number = memberNumber(record);
  const isReference = record.title === "Data tanpa nama" || record.title === number ||
    record.title === field(record, "Kode produk") || record.title === field(record, "Kode pinjaman", "Nomor kontrak");
  return record.memberName ?? (isReference ? undefined : record.title);
}

export function rowBasis(group: ExcelApplyGroup, index: number, row: ExcelImportRecord) {
  return createHash("sha256").update(JSON.stringify([group, index, row])).digest("hex");
}

export function locateSourceMember(record: ExcelImportRecord, candidates: ExcelImportRecord[]) {
  const number = memberNumber(record);
  const name = sourceMemberName(record);
  if (!number) return undefined;
  const matches = candidates.filter((candidate) => memberNumber(candidate) === number &&
    (!name || normalize(candidate.title) === normalize(name)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function draftMemberFields(record: ExcelImportRecord) {
  const flag = (value: string) => {
    const label = normalize(value);
    return !label || ["tidak", "false", "0"].includes(label) ? false : ["ya", "true", "1"].includes(label) ? true : value;
  };
  return {
    fullName: sourceMemberName(record) ?? "", nik: field(record, "NIK", "NIK Anggota"), address: field(record, "Alamat"),
    birthPlace: field(record, "Tempat lahir"), birthDate: field(record, "Tanggal lahir"), occupation: field(record, "Pekerjaan"),
    isPengurus: flag(field(record, "Pengurus")), isPengawas: flag(field(record, "Pengawas"))
  };
}

export function editableIdentity(record: ExcelImportRecord): ExcelCorrectionIdentity {
  const fields = draftMemberFields(record);
  return { ...fields, isPengurus: fields.isPengurus === true, isPengawas: fields.isPengawas === true };
}

export function correctedLoan(loan: ExcelCorrectionLoan, productId: string) {
  return { ...loan, contractRef: loan.contractRef.trim().toUpperCase(), sourceRow: 4, productId } satisfies Parameters<typeof validateLoanOpening>[0];
}

export function loanIssue(error: unknown) {
  if (!(error instanceof AppError)) throw error;
  return error.clientMessage.replace(/^Baris \d+: /, "");
}
