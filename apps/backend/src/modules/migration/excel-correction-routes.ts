import { createHash } from "node:crypto";
import { Router } from "express";
import type { ExcelCorrectionDetail, ExcelImportData, ExcelImportRecord } from "@siskop/types";
import { z } from "zod";
import { db, type TxClient } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { requireParam } from "../../lib/http.js";
import { businessDate, dateKey } from "../../lib/operating-calendar.js";
import { handle } from "../../lib/public-guards.js";
import { authClaims } from "../../middleware/auth.js";
import { recordAudit } from "../audit-log/service.js";
import { loanEntries, resolveLoanContract, savingsFields } from "./excel-apply-plan.js";
import { correctedLoan, editableIdentity, excelCorrection, excelDate, field, importGroups, loanIssue, locateSourceMember,
  memberNumber, normalize, rowBasis, sourceMemberName, type DraftCorrections } from "./excel-corrections.js";
import { validateLoanOpening } from "./kopkar-publish.js";

const unitIdSchema = z.string().min(1).max(64);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const keys = z.object({ group: z.enum(importGroups), index: z.coerce.number().int().min(0).max(20_000) });
const selection = z.object({ unitId: unitIdSchema, basis: fingerprint, slot: z.string().max(300).optional() });
const submit = selection.extend({ revision: fingerprint, cutoffDate: excelDate.optional(), correction: excelCorrection }).strict();
const contains = (query: string) => ({ contains: query, mode: "insensitive" as const });
const memberSelect = { id: true, memberId: true, fullName: true } as const;

function selectableMember(tenantId: string, unitId: string) {
  return { tenantId, isActive: true, identityUnverified: false, nik: { not: null }, memberships: { some: { unitId } } };
}

async function loadRow(tx: TxClient | typeof db, tenantId: string, draftId: string, key: z.infer<typeof keys>, input: z.infer<typeof selection>) {
  const draft = await tx.excelImportDraft.findFirst({ where: { tenantId, id: draftId }, select: { records: true, corrections: true } });
  if (!draft) throw notFound("Draf tidak ditemukan.");
  if (!await tx.cooperativeUnit.findFirst({ where: { tenantId, id: input.unitId, isActive: true }, select: { id: true } })) {
    throw validationError("Unit yang dipilih tidak aktif.");
  }
  const records = draft.records as unknown as ExcelImportData;
  const record = records[key.group][key.index];
  if (!record || rowBasis(key.group, key.index, record) !== input.basis) throw conflict("Data sumber berubah. Periksa ulang draf.");
  const related = key.group === "anggota" ? record : locateSourceMember(record, records.anggota);
  const memberBasis = related ? rowBasis("anggota", records.anggota.indexOf(related), related) : input.basis;
  const corrections = (draft.corrections ?? {}) as DraftCorrections;
  const edited = corrections[input.basis];
  const member = edited?.member ?? corrections[memberBasis]?.member;
  const revision = createHash("sha256").update(JSON.stringify([edited, corrections[memberBasis]])).digest("hex");
  return { records, record, related, memberBasis, corrections, edited, member, revision };
}

function loanProducts(tenantId: string) {
  return { tenantId, isActive: true, installmentFrequency: "MONTHLY" as const };
}

function sameSourceMember(anchor: ExcelImportRecord, incoming: ExcelImportRecord) {
  const nik = field(anchor, "NIK", "NIK Anggota");
  const otherNik = field(incoming, "NIK", "NIK Anggota");
  if (nik && otherNik) return nik === otherNik;
  const number = memberNumber(anchor);
  const name = sourceMemberName(anchor);
  const incomingName = sourceMemberName(incoming);
  return Boolean(number && number === memberNumber(incoming) && name && incomingName && normalize(name) === normalize(incomingName));
}

export function excelCorrectionRoutes() {
  const router = Router({ mergeParams: true });

  router.get("/member-candidates", handle(async (req, res) => {
    const { tenantId } = authClaims(req);
    const draftId = requireParam(req, "id");
    const { unitId, q } = z.object({ unitId: unitIdSchema, q: z.string().trim().min(2).max(150) }).parse(req.query);
    if (!await db.excelImportDraft.findFirst({ where: { tenantId, id: draftId }, select: { id: true } })) throw notFound("Draf tidak ditemukan.");
    const members = await db.member.findMany({
      where: { ...selectableMember(tenantId, unitId), OR: [{ fullName: contains(q) }, { memberId: contains(q) }, { nik: q }] },
      take: 12, orderBy: { fullName: "asc" }, select: memberSelect
    });
    res.json({ success: true, data: members.map(({ id, memberId, fullName }) => ({ id, memberNumber: memberId, fullName })), meta: res.locals.meta });
  }));

  router.get("/corrections/:group/:index", handle(async (req, res) => {
    const { tenantId } = authClaims(req);
    const draftId = requireParam(req, "id");
    const key = keys.parse(req.params);
    const input = selection.parse(req.query);
    const { records, record, related, edited, member, revision } = await loadRow(db, tenantId, draftId, key, input);
    const relatedRows: ExcelCorrectionDetail["related"] = { anggota: [], simpanan: [], pinjaman: [] };
    for (const group of importGroups) {
      relatedRows[group] = records[group].flatMap((candidate, index) => {
        if (candidate !== record && candidate !== related && !sameSourceMember(related ?? record, candidate)) return [];
        if (group === "pinjaman" && /(?:jadwal|angsuran)/i.test(candidate.sheet) && field(candidate, "Jatuh tempo")) return [];
        return [{ group, index, basis: rowBasis(group, index, candidate),
          label: field(candidate, "Kode pinjaman", "Nomor kontrak") || candidate.sheet }];
      });
    }
    const linked = member?.mode === "link" ? await db.member.findFirst({
      where: { ...selectableMember(tenantId, input.unitId), id: member.memberId }, select: memberSelect
    }) : null;
    const products = key.group === "simpanan"
      ? (await db.savingConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }))
          .map((p) => ({ ...p, rate: undefined }))
      : key.group === "pinjaman"
        ? (await db.loanConfig.findMany({ where: loanProducts(tenantId), select: { id: true, name: true, rate: true }, orderBy: { name: "asc" } }))
            .map((p) => ({ id: p.id, name: p.name, rate: String(p.rate) }))
        : [];
    const savingFields = key.group === "simpanan" ? savingsFields(record) : undefined;
    const savingEntries = savingFields && (savingFields.length ? savingFields : [{ label: "", value: "" }]).map((entry) => {
      const slot = normalize(entry.label);
      const saved = edited?.savings?.find((value) => value.slot === slot);
      return { slot, label: entry.label || "Saldo dari Excel", amount: saved?.amount ?? entry.value,
        productId: saved?.productId ?? products.find((product) => normalize(product.name) === slot)?.id };
    });
    const saving = savingEntries?.find((entry) => entry.slot === input.slot);
    const ref = field(record, "Kode pinjaman", "Nomor kontrak");
    const loanSlot = key.group === "pinjaman"
      ? (loanEntries(record).find((entry) => entry.loanSlot?.slot === input.slot)?.loanSlot ?? loanEntries(record)[0]?.loanSlot)
      : undefined;
    const defaultLoanRate = products.length === 1 && products[0]?.rate ? products[0].rate : "0";
    const autoContract = key.group === "pinjaman" && !edited?.loan?.contract
      ? resolveLoanContract(record, loanSlot, new Map(), dateKey(businessDate()), defaultLoanRate, key.index)
      : undefined;
    const contract = key.group === "pinjaman" ? edited?.loan?.contract ?? (autoContract ? {
      contractRef: autoContract.contractRef,
      disbursedAt: autoContract.disbursedAt,
      principalAmount: autoContract.principalAmount,
      totalAmount: autoContract.totalAmount,
      remainingPrincipal: autoContract.remainingPrincipal,
      remainingAmount: autoContract.remainingAmount,
      termMonths: autoContract.termMonths,
      rate: autoContract.rate,
      installmentAmount: autoContract.installmentAmount,
      schedule: autoContract.schedule
    } : {
      contractRef: ref, disbursedAt: field(record, "Tanggal cair"), principalAmount: field(record, "Pokok awal"),
      totalAmount: field(record, "Total kewajiban"), remainingPrincipal: field(record, "Sisa pokok"), remainingAmount: field(record, "Sisa kewajiban"),
      termMonths: Number(field(record, "Tenor", "Tenor (bulan)")), rate: field(record, "Tarif"), installmentAmount: field(record, "Angsuran per periode"),
      schedule: ref ? records.pinjaman.filter((line) => /(?:jadwal|angsuran)/i.test(line.sheet) && field(line, "Kode pinjaman", "Nomor kontrak") === ref)
        .map((line) => ({ dueDate: field(line, "Jatuh tempo"), principal: field(line, "Pokok tagihan"),
          margin: field(line, "Bunga tagihan", "Margin tagihan", "Infaq tagihan") })) : []
    }) : undefined;
    const data: ExcelCorrectionDetail = {
      revision, identity: member?.mode === "identity" ? member.identity : editableIdentity(related ?? record),
      member: linked ? { id: linked.id, memberNumber: linked.memberId, fullName: linked.fullName } : undefined,
      source: { name: record.title, memberNumber: memberNumber(record), sheet: record.sheet,
        amounts: record.fields.filter((item) => item.kind === "money") }, products, related: relatedRows,
      productId: saving?.productId ?? edited?.loan?.productId ?? products.find((product) =>
        normalize(product.name) === normalize(field(record, "Nama produk", "Kode produk")))?.id,
      amount: saving?.amount, savingEntries, contract
    };
    res.json({ success: true, data, meta: res.locals.meta });
  }));

  router.post("/corrections/:group/:index", handle(async (req, res) => {
    const { tenantId } = authClaims(req);
    const draftId = requireParam(req, "id");
    const key = keys.parse(req.params);
    const input = submit.parse(req.body);
    const { correction } = input;
    if ((correction.kind === "saving" && key.group !== "simpanan") || (correction.kind === "loan" && key.group !== "pinjaman")) {
      throw validationError("Jenis koreksi tidak cocok dengan data impor.");
    }
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExcelImportDraft" WHERE id = ${draftId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const { record, memberBasis, corrections, revision } = await loadRow(tx, tenantId, draftId, key, input);
      if (revision !== input.revision) throw conflict("Koreksi berubah. Buka kembali data ini.");
      if (correction.kind === "member") {
        if (correction.member.mode === "link" && !await tx.member.findFirst({
          where: { ...selectableMember(tenantId, input.unitId), id: correction.member.memberId }, select: { id: true }
        })) throw validationError("Pilih anggota aktif yang identitasnya terverifikasi di unit ini.");
        corrections[memberBasis] = { ...corrections[memberBasis], member: correction.member };
      } else if (correction.kind === "saving") {
        const incoming = savingsFields(record);
        const slot = input.slot ?? "";
        if (incoming.length ? !incoming.some((entry) => normalize(entry.label) === slot) : slot !== "") {
          throw conflict("Produk sumber berubah. Buka kembali data ini.");
        }
        if (correction.productId && !await tx.savingConfig.findFirst({ where: { tenantId, id: correction.productId, isActive: true }, select: { id: true } })) {
          throw validationError("Pilih produk simpanan aktif.");
        }
        const savings = corrections[input.basis]?.savings?.filter((item) => item.slot !== slot) ?? [];
        corrections[input.basis] = { ...corrections[input.basis], savings: [...savings,
          { slot, amount: correction.amount, ...(correction.productId ? { productId: correction.productId } : {}) }] };
      } else {
        if (correction.productId && !await tx.loanConfig.findFirst({ where: { ...loanProducts(tenantId), id: correction.productId }, select: { id: true } })) {
          throw validationError("Pilih produk pinjaman bulanan yang aktif.");
        }
        try { validateLoanOpening(correctedLoan(correction.contract, correction.productId ?? ""), input.cutoffDate ?? dateKey(businessDate())); }
        catch (error) { throw validationError(loanIssue(error)); }
        corrections[input.basis] = { ...corrections[input.basis], loan: {
          contract: correction.contract, ...(correction.productId ? { productId: correction.productId } : {})
        } };
      }
      await tx.excelImportDraft.update({ where: { tenantId, id: draftId }, data: { corrections } });
      await recordAudit(tx, { action: "excel.correct", entityType: "ExcelImportDraft", entityId: draftId,
        after: { group: key.group, kind: correction.kind, unitId: input.unitId } });
    });
    res.json({ success: true, data: { saved: true }, meta: res.locals.meta });
  }));
  return router;
}
