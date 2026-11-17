import { z } from "zod";
import type { ProvisionalMember } from "@siskop/types";
import { memberFieldsSchema } from "../members/schema.js";

export const MAX_RAT_BATCH_ROWS = 25;

const correctedIdentity = memberFieldsSchema
  .strict()
  .refine((identity) => {
    const date = new Date(identity.birthDate + "T00:00:00.000Z");
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === identity.birthDate && date <= new Date();
  }, { path: ["birthDate"], message: "Tanggal lahir tidak valid" });

export const verifiedRatMemberRow = z.discriminatedUnion("action", [
  z.object({ sourceRow: z.number().int().min(4), action: z.literal("create"), identity: correctedIdentity }).strict(),
  z.object({
    sourceRow: z.number().int().min(4), action: z.literal("link"),
    memberId: z.string().min(1).max(64), verifiedNik: memberFieldsSchema.shape.nik
  }).strict()
]);

type SourceMember = Pick<ProvisionalMember, "sourceRow" | "temporaryId" | "fullName">;
type ExistingMember = { id: string; memberId: string; nik: string | null; fullName: string; isActive: boolean };
type BatchIssue = { sourceRow: number | null; field: string; message: string };
type PreviewRow = SourceMember & { action: "create" | "link"; linkedMemberNumber?: string };

/** Preview never supplies guessed identity values or links a member by name alone. */
export function checkVerifiedMemberBatch(
  input: unknown[],
  source: SourceMember[],
  existing: ExistingMember[]
): { canPublish: boolean; issues: BatchIssue[]; rows: PreviewRow[] } {
  if (!input.length || input.length > MAX_RAT_BATCH_ROWS) {
    return { canPublish: false, issues: [{ sourceRow: null, field: "rows", message: "Pilih 1–25 baris anggota per batch." }], rows: [] };
  }

  const issues: BatchIssue[] = [];
  const rows: PreviewRow[] = [];
  const sourceByRow = new Map(source.map((row) => [row.sourceRow, row]));
  const existingById = new Map(existing.flatMap((member) => [[member.id, member] as const, [member.memberId, member] as const]));
  const existingNiks = new Set(existing.map((member) => member.nik));
  const seenRows = new Set<number>();
  const seenNiks = new Set<string>();

  for (const raw of input) {
    const row = z.object({ sourceRow: z.number().int().min(4) }).safeParse(raw);
    const sourceRow = row.success ? row.data.sourceRow : null;
    const err = (field: string, message: string) => issues.push({ sourceRow, field, message });
    const candidate = sourceRow === null ? undefined : sourceByRow.get(sourceRow);
    if (sourceRow === null || !candidate || seenRows.has(sourceRow)) {
      err("sourceRow", candidate ? "Baris ini dipilih lebih dari sekali." : "Baris anggota tidak ada di arsip Kopkar.");
      continue;
    }
    seenRows.add(sourceRow);

    const parsed = verifiedRatMemberRow.safeParse(raw);
    if (!parsed.success) {
      const seenFields = new Set<string>();
      for (const issue of parsed.error.issues) {
        const field = String(issue.path.at(-1) ?? "row");
        if (!seenFields.has(field)) err(field, issue.message);
        seenFields.add(field);
      }
      continue;
    }
    const data = parsed.data;

    const nik = data.action === "create" ? data.identity.nik : data.verifiedNik;
    if (seenNiks.has(nik)) {
      err(data.action === "create" ? "nik" : "verifiedNik", "NIK sudah dipakai pada baris lain dalam batch ini.");
      continue;
    }
    seenNiks.add(nik);
    if (data.action === "create") {
      if (existingNiks.has(nik)) {
        err("nik", "NIK sudah terdaftar. Cocokkan dengan anggota yang ada.");
        continue;
      }
      rows.push({ ...candidate, fullName: data.identity.fullName, action: "create" });
      continue;
    }

    const match = existingById.get(data.memberId);
    if (!match?.isActive) {
      err("memberId", "Pilih anggota aktif di Kopkar.");
    } else if (match.nik !== nik) {
      err("verifiedNik", "NIK terverifikasi tidak cocok dengan anggota yang dipilih.");
    } else {
      rows.push({ ...candidate, action: "link", linkedMemberNumber: match.memberId });
    }
  }
  return { canPublish: issues.length === 0, issues, rows };
}
