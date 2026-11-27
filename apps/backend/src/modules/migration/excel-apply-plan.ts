import { Prisma } from "@prisma/client";
import type { ExcelApplyItem, ExcelImportData, ExcelImportRecord } from "@siskop/types";
import { z } from "zod";
import type { TxClient } from "../../lib/db.js";
import { notFound, validationError } from "../../lib/errors.js";
import { businessDate, dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { createMemberSchema } from "../members/schema.js";
import { correctedLoan, draftMemberFields, excelDate as day, field, importGroups, loanIssue, locateSourceMember, memberNumber, normalize,
  rowBasis, sourceMemberName, type DraftCorrections } from "./excel-corrections.js";
import { validateLoanOpening } from "./kopkar-publish.js";

const id = z.string().min(1).max(64);
export const excelApplySettings = z.discriminatedUnion("group", [
  z.object({ group: z.literal("anggota"), unitId: id }).strict(),
  z.object({ group: z.literal("simpanan"), unitId: id, cutoffDate: day.optional() }).strict(),
  z.object({ group: z.literal("pinjaman"), unitId: id, cutoffDate: day.optional() }).strict()
]);
type Settings = z.infer<typeof excelApplySettings>;
type Identity = z.infer<typeof createMemberSchema>;
type VerifiedLoan = Parameters<typeof validateLoanOpening>[0];
type Candidate =
  | { group: "anggota"; identity: Identity }
  | { group: "simpanan"; memberId: string; productId: string; accountId: string; amount: string; savingType: string }
  | { group: "pinjaman"; memberId: string; productId: string; accountId: string; amount: string; contract: VerifiedLoan };
type Item = ExcelApplyItem & { candidate?: Candidate; keys?: string[]; productName?: string };

const MAX_BATCH = 50;
const openingAccounts = { isActive: true, isHeader: false, isCashEquivalent: false, category: { in: ["ASET", "KEWAJIBAN", "EKUITAS"] } } satisfies Prisma.AccountWhereInput;
const openingAccountName = "Saldo Awal Impor Excel";
const loanSignature = (memberId: string, amount: string, date: string) => JSON.stringify([memberId, amount, date]);

function decimal(value: string) {
  // shortcut: text balances must use an unambiguous decimal format; support locale-specific strings once the workbook supplies a locale.
  return /^\d{1,13}(?:\.\d{1,2})?$/.test(value) ? new Prisma.Decimal(value).toFixed(2) : undefined;
}

export function savingsFields(record: ExcelImportRecord) {
  const categories = [
    { type: "POKOK_WAJIB", aliases: ["Total Simpanan Pokok & Wajib", "Simpanan Pokok & Wajib", "Pokok + Wajib", "Simpanan Pokok + Wajib"], label: "Simpanan Pokok + Wajib" },
    { type: "POKOK", aliases: ["Simpanan Pokok", "Pokok"], label: "Simpanan Pokok" },
    { type: "WAJIB", aliases: ["Simpanan Wajib", "Wajib"], label: "Simpanan Wajib" },
    { type: "SUKARELA", aliases: ["Total Tabungan Sukarela", "Tabungan Sukarela", "Simpanan Sukarela", "Sukarela"], label: "Tabungan Sukarela" },
    { type: undefined, aliases: ["Total Tabungan Qurban", "Tabungan Qurban", "Tabungan Kurban"], label: "Tabungan Qurban" }
  ] as const;
  const explicit: { type: string | undefined; label: string; value: string }[] = categories.flatMap(({ aliases, ...category }) => {
    const value = field(record, ...aliases);
    return value ? [{ ...category, value }] : [];
  });
  const handled = new Set(categories.flatMap(({ aliases }) => aliases.map(normalize)));
  for (const item of record.fields) {
    if (item.kind !== "money" || handled.has(normalize(item.label)) || !/^(?:total )?(?:simpanan|tabungan) /i.test(item.label) ||
        /\b20\d{2}\b/.test(item.label)) continue;
    const label = item.label.replace(/^total /i, "");
    if (record.fields.some((other) => other.label.toLowerCase() === ("total " + item.label).toLowerCase())) continue;
    const value = field(record, item.label);
    if (value) explicit.push({ type: undefined, label, value });
  }
  if (explicit.length) return explicit.filter(({ value }) => decimal(value) !== "0.00");

  const value = field(record, "Saldo", "Saldo awal", "Saldo akhir");
  const label = field(record, "Kode produk", "Nama produk", "Jenis simpanan");
  return value && label && decimal(value) !== "0.00" ? [{ type: undefined, label, value }] : [];
}

export async function planExcelApply(tx: TxClient, tenantId: string, draftId: string, settings: Settings) {
  const { group, unitId } = settings;
  const draft = await tx.excelImportDraft.findFirst({ where: { id: draftId, tenantId }, select: { records: true, corrections: true } });
  if (!draft) throw notFound("Draf tidak ditemukan.");
  const unit = await tx.cooperativeUnit.findFirst({ where: { tenantId, id: unitId, isActive: true, ...(group === "anggota" ? {} : { type: "KSP" }) }, select: { name: true } });
  if (!unit) throw validationError("Pilih unit koperasi yang aktif. Saldo awal memerlukan unit simpan pinjam.");
  const records = draft.records as unknown as ExcelImportData;
  const corrections = (draft.corrections ?? {}) as DraftCorrections;
  const refs = new Map(importGroups.flatMap((group) => records[group].map((record, index) => [
    record, { group, index, basis: rowBasis(group, index, record) }
  ] as const)));
  const correction = (record: ExcelImportRecord) => corrections[refs.get(record)!.basis];
  const members = await tx.member.findMany({
    where: { tenantId },
    select: { id: true, memberId: true, fullName: true, nik: true, isActive: true, identityUnverified: true,
      memberships: { where: { unitId }, select: { unitId: true } } }
  });
  const byNik = new Map(members.flatMap((member) => member.nik ? [[member.nik, member] as const] : []));
  const byId = new Map(members.map((member) => [member.id, member]));
  const byNumber = new Map(members.map((member) => [member.memberId, member]));
  const liveNames = new Set(members.map((member) => normalize(member.fullName)));
  const sourceMembers = new Map<string, ExcelImportRecord[]>();
  for (const record of records.anggota) {
    const number = memberNumber(record);
    if (number) sourceMembers.set(number, [...(sourceMembers.get(number) ?? []), record]);
  }
  const relatedMember = (record: ExcelImportRecord) => locateSourceMember(record, sourceMembers.get(memberNumber(record)) ?? []);
  const memberCorrection = (record: ExcelImportRecord) => {
    const source = relatedMember(record);
    return correction(record)?.member ?? (source ? correction(source)?.member : undefined);
  };
  const memberMatch = (record: ExcelImportRecord) => {
    const edited = memberCorrection(record);
    if (edited?.mode === "link") return byId.get(edited.memberId);
    const number = memberNumber(record);
    const name = sourceMemberName(record);
    const source = relatedMember(record);
    const nik = edited?.identity.nik ?? (field(record, "NIK", "NIK Anggota") || (source ? field(source, "NIK", "NIK Anggota") : ""));
    const member = nik ? byNik.get(nik) : byNumber.get(number);
    const sourceName = edited?.identity.fullName ?? name ?? source?.title;
    return member && (sourceName ? normalize(sourceName) === normalize(member.fullName) : Boolean(nik)) ? member : undefined;
  };
  const pending = (name: string, description: string, fix?: ExcelApplyItem["fix"]): Item => ({ name, description, status: "review", fix });
  const exists = (name: string, description: string): Item => ({ name, description, status: "existing" });
  const items: Item[] = [];
  let offset: { id?: string; name: string; code: string } | undefined;
  let postingIssue: string | undefined;

  if (group === "anggota") {
    const memberDrafts = [...records.anggota, ...[...records.simpanan, ...records.pinjaman].filter(
      (record) => correction(record)?.member?.mode === "identity" && !relatedMember(record)
    )];
    for (const record of memberDrafts) {
      const name = record.title;
      const fix = { ...refs.get(record)!, kind: "member" as const };
      const match = memberMatch(record);
      if (match && match.isActive && !match.identityUnverified && match.memberships.length) {
        items.push(exists(name, "Anggota " + match.memberId + " sudah terdaftar."));
        continue;
      }
      const edited = memberCorrection(record);
      const parsed = createMemberSchema.safeParse(edited?.mode === "identity" ? edited.identity : draftMemberFields(record));
      if (!parsed.success || !day.safeParse(parsed.data.birthDate).success ||
          parsed.data.birthDate > dateKey(businessDate()) || edited?.mode === "link" || match ||
          liveNames.has(normalize(parsed.data.fullName)) || byNik.has(parsed.data.nik)) {
        const identityLabels: Record<string, string> = { fullName: "nama", nik: "NIK", address: "alamat", birthPlace: "tempat lahir",
          birthDate: "tanggal lahir", occupation: "pekerjaan", isPengurus: "status pengurus", isPengawas: "status pengawas" };
        const missing = parsed.success ? [] : [...new Set(parsed.error.issues.map((issue) => identityLabels[String(issue.path[0])]).filter(Boolean))];
        items.push(pending(name, match || liveNames.has(normalize(name)) || (parsed.success && byNik.has(parsed.data.nik))
          ? "Ada anggota dengan nama atau NIK ini. Pilih anggota aktif yang terverifikasi di unit ini."
          : missing.length ? "Lengkapi atau perbaiki " + missing.join(", ") + "." : "Periksa identitas dan tanggal lahir anggota.", fix));
        continue;
      }
      items.push({ name, description: "Anggota baru", status: "ready", fix, keys: [parsed.data.nik], candidate: { group, identity: parsed.data } });
    }
  } else {
    const today = dateKey(businessDate());
    if (!settings.cutoffDate) postingIssue = "Isi tanggal saldo sebelum menerapkan data.";
    else if (settings.cutoffDate > today) postingIssue = "Tanggal saldo tidak boleh di masa depan.";
    else if (await tx.fiscalYearClose.findFirst({ where: { tenantId, year: Number(settings.cutoffDate.slice(0, 4)), reopenedAt: null }, select: { id: true } })) {
      postingIssue = "Tahun buku pada tanggal saldo sudah ditutup.";
    }
    const offsetCandidates = await tx.account.findMany({
      where: { tenantId, ...openingAccounts, name: openingAccountName, category: "EKUITAS", normalBalance: "KREDIT", equityClass: "EKUITAS_LAIN" },
      select: { id: true, code: true, name: true }, take: 2
    });
    if (offsetCandidates.length === 1) offset = offsetCandidates[0];
    else if (offsetCandidates.length === 0) {
      const used = new Set((await tx.account.findMany({ where: { tenantId, code: { startsWith: "3-99" } }, select: { code: true } })).map((account) => account.code));
      const code = Array.from({ length: 99 }, (_, index) => "3-" + (9999 - index)).find((candidate) => !used.has(candidate));
      if (code) offset = { code, name: openingAccountName };
    }
    if (!offset) postingIssue ??= "Akun saldo awal otomatis perlu diperiksa di pengaturan pembukuan.";
    const mappings = await tx.accountMapping.findMany({
      where: { tenantId, sourceType: group === "simpanan" ? "SAVING_CONFIG" : "LOAN_CONFIG" },
      select: { sourceId: true, transactionKind: true, debitAccountId: true, creditAccountId: true }
    });
    const accounts = new Map((await tx.account.findMany({
      where: { tenantId, ...openingAccounts }, select: { id: true, category: true, name: true, code: true }
    })).map((account) => [account.id, account]));
    const products = group === "simpanan" ? await tx.savingConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, type: true } }) :
      (await tx.loanConfig.findMany({ where: { tenantId, isActive: true, installmentFrequency: "MONTHLY" }, select: { id: true, name: true } }))
        .map((product) => ({ ...product, type: undefined }));
    const savings = group === "simpanan" ? await tx.saving.findMany({
      where: { tenantId, unitId }, select: { memberId: true, savingConfigId: true, savingConfig: { select: { type: true } } }
    }) : [];
    const liveSavings = new Set(savings.map((saving) => JSON.stringify([saving.memberId, saving.savingConfigId])));
    const liveSavingTypes = new Set(savings.map((saving) => JSON.stringify([saving.memberId, saving.savingConfig.type])));
    const liveLoans = group === "pinjaman" ? await tx.loan.findMany({
      where: { tenantId }, select: { notes: true, memberId: true, principalAmount: true, disbursedAt: true }
    }) : [];
    const liveContracts = new Set(liveLoans.map((loan) => loan.notes));
    const liveSignatures = new Set(liveLoans.flatMap((loan) => loan.disbursedAt ?
      [loanSignature(loan.memberId, loan.principalAmount.toFixed(2), dateKey(loan.disbursedAt))] : []));
    const schedules = new Map<string, ExcelImportRecord[]>();
    if (group === "pinjaman") {
      for (const line of records.pinjaman) {
        if (!/(?:jadwal|angsuran)/i.test(line.sheet) || !field(line, "Jatuh tempo")) continue;
        const ref = field(line, "Kode pinjaman", "Nomor kontrak");
        if (ref) schedules.set(ref, [...(schedules.get(ref) ?? []), line]);
      }
    }
    for (const record of records[group]) {
      if (group === "pinjaman" && /(?:jadwal|angsuran)/i.test(record.sheet) && field(record, "Jatuh tempo")) continue;
      const name = record.title;
      const member = memberMatch(record);
      if (!member || !member.isActive || member.identityUnverified || !member.memberships.length) {
        const reason = !member ? (memberCorrection(record)?.mode === "identity"
          ? "Identitas sudah disimpan. Terapkan anggota dari tab Anggota terlebih dahulu."
          : "Anggota dari Excel belum cocok dengan data anggota di sistem.")
          : !member.isActive ? "Anggota yang cocok tidak aktif." : member.identityUnverified ? "Identitas anggota yang cocok belum terverifikasi."
            : "Anggota yang cocok belum terdaftar di unit yang dipilih.";
        items.push(pending(name, reason, { ...refs.get(record)!, kind: "member" }));
        continue;
      }
      const edited = correction(record);
      const parsedSavings = group === "simpanan" ? savingsFields(record) : [];
      const incoming = group === "simpanan" ? (parsedSavings.length ? parsedSavings : [{ label: "", value: "", type: undefined }]) : [{
        label: field(record, "Kode produk", "Nama produk", "Jenis pinjaman"),
        value: field(record, "Sisa pokok"), type: undefined
      }];
      for (const entry of incoming) {
        const slot = normalize(entry.label);
        const fix = { ...refs.get(record)!, kind: group === "simpanan" ? "saving" as const : "loan" as const, slot };
        const savingEdit = group === "simpanan" ? edited?.savings?.find((item) => item.slot === slot) : undefined;
        const saved = group === "simpanan" ? savingEdit : edited?.loan;
        const productName = normalize(entry.label);
        const equivalentNames = productName === "tabungansukarela" ? ["tabungansukarela", "simpanansukarela", "sukarela"] : [productName];
        const exact = products.filter((p) => (!entry.type || entry.type === p.type) &&
          (p.id === entry.label || equivalentNames.includes(normalize(p.name))));
        const options = exact.length || !entry.type || entry.type === "SUKARELA" ? exact : products.filter((p) => p.type === entry.type);
        const product = saved?.productId ? products.find((item) => item.id === saved.productId) : options.length === 1 ? options[0] : undefined;
        const amount = decimal(group === "simpanan" ? savingEdit?.amount ?? entry.value
          : edited?.loan?.contract.remainingPrincipal ?? entry.value);
        if (!product || !amount || amount === "0.00") {
          items.push(pending(name, group === "simpanan" ? (!product ? "Produk simpanan belum cocok" + (entry.label ? ": " + entry.label : ".")
            : "Saldo simpanan belum berupa angka positif.") : !product ? "Produk pinjaman belum cocok." : "Sisa pokok pinjaman belum berupa angka positif.", fix));
          continue;
        }
        const mapping = mappings.find((m) => m.sourceId === product.id && m.transactionKind === (group === "simpanan" ? "DEPOSIT" : "DISBURSEMENT"));
        const account = accounts.get((group === "simpanan" ? mapping?.creditAccountId : mapping?.debitAccountId) ?? "");
        if (!account || account.id === offset?.id || (group === "simpanan" ? !["KEWAJIBAN", "EKUITAS"].includes(account.category) : account.category !== "ASET")) {
          items.push(pending(name, "Pemetaan akun produk " + product.name + " belum lengkap. Periksa Pengaturan atau pilih produk lain.", fix));
          continue;
        }
        const key = JSON.stringify([member.id, product.id]);
        const description = product.name + " · " + account.code + " " + account.name;
        if (group === "simpanan") {
          if (!product.type) continue;
          const overlaps = product.type === "POKOK_WAJIB" ? ["POKOK", "WAJIB"] : ["POKOK", "WAJIB"].includes(product.type) ? ["POKOK_WAJIB"] : [];
          if (overlaps.some((type) => liveSavingTypes.has(JSON.stringify([member.id, type])))) {
            items.push(pending(name, "Sudah ada saldo pokok atau wajib yang tumpang tindih. Rekonsiliasi rekening yang ada.", fix));
            continue;
          }
          items.push(liveSavings.has(key) ? exists(name, product.name + " sudah memiliki rekening di unit ini.") : {
            name, description, amount, status: "ready", fix, keys: [key], productName: product.name,
            candidate: { group, amount, productId: product.id, memberId: member.id, accountId: account.id, savingType: product.type }
          });
          continue;
        }
        const contract = edited?.loan ? correctedLoan(edited.loan.contract, product.id) : loanContract(record, schedules);
        if (!contract) {
          items.push(pending(name, "Rincian kontrak atau jadwal angsuran tersisa belum lengkap.", fix));
          continue;
        }
        try { validateLoanOpening(contract, settings.cutoffDate ?? today); }
        catch (error) { items.push(pending(name, loanIssue(error), fix)); continue; }
        if (!mappings.some((m) => m.sourceId === product.id && m.transactionKind === "PAYMENT_PRINCIPAL" && m.creditAccountId === account.id) ||
            (new Prisma.Decimal(contract.remainingAmount).gt(amount) && !mappings.some((m) => m.sourceId === product.id && m.transactionKind === "PAYMENT_INTEREST"))) {
          items.push(pending(name, "Pemetaan pembayaran pokok atau margin belum lengkap. Periksa Pengaturan atau pilih produk lain.", fix));
          continue;
        }
        const signature = loanSignature(member.id, contract.principalAmount, contract.disbursedAt);
        const existing = liveContracts.has(loanImportNote(contract.contractRef)) || liveSignatures.has(signature);
        items.push(existing ? exists(name, "Kontrak atau pinjaman dengan pokok dan tanggal cair yang sama sudah ada.") : {
          name, description: description + " · " + contract.contractRef, amount, remainingAmount: contract.remainingAmount,
          productName: product.name, status: "ready", fix, keys: [contract.contractRef, signature],
          candidate: { group, amount, contract, productId: product.id, memberId: member.id, accountId: account.id }
        });
      }
    }
  }

  const counts = new Map<string, number>();
  const combined = new Set<string>();
  const separate = new Set<string>();
  for (const item of items) {
    for (const key of item.keys ?? []) counts.set(key, (counts.get(key) ?? 0) + 1);
    const candidate = item.candidate;
    if (candidate?.group !== "simpanan") continue;
    if (candidate.savingType === "POKOK_WAJIB") combined.add(candidate.memberId);
    if (["POKOK", "WAJIB"].includes(candidate.savingType)) separate.add(candidate.memberId);
  }
  let ready = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!item.keys) continue;
    const candidate = item.candidate;
    if (candidate?.group === "simpanan" && ["POKOK", "WAJIB", "POKOK_WAJIB"].includes(candidate.savingType) &&
        combined.has(candidate.memberId) && separate.has(candidate.memberId)) {
      items[i] = pending(item.name, "Sumber memuat simpanan pokok dan wajib terpisah serta gabungan. Cocokkan dengan produk dan saldo yang benar.", item.fix);
    } else if (item.keys.some((key) => counts.get(key)! > 1)) items[i] = pending(item.name, "Ada lebih dari satu data sumber untuk anggota, rekening, atau kontrak ini.", item.fix);
    else if (ready >= MAX_BATCH) items[i] = pending(item.name, "Siap untuk batch berikutnya.");
    else ready++;
  }
  const total = items.reduce((sum, item) => item.candidate && item.amount ? sum.plus(item.amount) : sum, new Prisma.Decimal(0)).toFixed(2);
  const productTotals = new Map<string, { name: string; count: number; amount: Prisma.Decimal }>();
  for (const item of items) {
    if (!item.candidate || item.candidate.group === "anggota" || !item.productName || !item.amount) continue;
    const id = item.candidate.productId;
    const sum = productTotals.get(id) ?? { name: item.productName, count: 0, amount: new Prisma.Decimal(0) };
    sum.count++;
    sum.amount = sum.amount.plus(item.amount);
    productTotals.set(id, sum);
  }
  const products = [...productTotals.values()].map((product) => ({ ...product, amount: product.amount.toFixed(2) }));
  return { unit, offset, postingIssue, items, ready, total, products };
}

export function loanImportNote(contract: string) {
  return "Saldo awal Excel · Kontrak " + contract.toUpperCase();
}

function loanContract(record: ExcelImportRecord, schedules: Map<string, ExcelImportRecord[]>): VerifiedLoan | undefined {
  const ref = field(record, "Kode pinjaman", "Nomor kontrak");
  const disbursedAt = field(record, "Tanggal cair");
  const principalAmount = decimal(field(record, "Pokok awal"));
  const totalAmount = decimal(field(record, "Total kewajiban"));
  const remainingPrincipal = decimal(field(record, "Sisa pokok"));
  const remainingAmount = decimal(field(record, "Sisa kewajiban"));
  const installmentAmount = decimal(field(record, "Angsuran per periode"));
  const termMonths = Number(field(record, "Tenor", "Tenor (bulan)"));
  const rate = field(record, "Tarif");
  if (!ref || ref.length > 64 || !day.safeParse(disbursedAt).success || !principalAmount || !totalAmount || !remainingPrincipal ||
      !remainingAmount || !installmentAmount || installmentAmount === "0.00" || !/^\d{1,3}(?:\.\d{1,4})?$/.test(rate) ||
      !Number.isInteger(termMonths) || termMonths < 1 || termMonths > 360) return undefined;
  const schedule: VerifiedLoan["schedule"] = [];
  for (const line of schedules.get(ref) ?? []) {
    const dueDate = field(line, "Jatuh tempo");
    const principal = decimal(field(line, "Pokok tagihan"));
    const margin = decimal(field(line, "Bunga tagihan", "Margin tagihan", "Infaq tagihan"));
    if (!day.safeParse(dueDate).success || principal === undefined || margin === undefined ||
        ["Pokok terbayar", "Bunga terbayar", "Margin terbayar"].some((label) => Number(field(line, label)) !== 0)) return undefined;
    schedule.push({ dueDate, principal, margin });
  }
  if (!schedule.length) return undefined;
  schedule.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { sourceRow: 4, contractRef: ref.toUpperCase(), productId: "", disbursedAt, principalAmount, totalAmount, remainingPrincipal,
    remainingAmount, installmentAmount, termMonths, rate, schedule };
}
