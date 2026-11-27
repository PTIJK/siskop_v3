import { createHash } from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import type { ExcelApplyReceipt, ExcelApplyReview, ExcelBalanceDates } from "@siskop/types";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { requireParam } from "../../lib/http.js";
import { generateAccountNumber, generateMemberId } from "../../lib/id-generator.js";
import { createJournalEntry } from "../../lib/journal.js";
import { getKOLCategory } from "../../lib/kol.js";
import { businessDate, dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { assertQuota } from "../../lib/pricing/entitlements.js";
import { handle } from "../../lib/public-guards.js";
import { authClaims } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { recordAudit } from "../audit-log/service.js";
import { excelApplySettings, loanImportNote, planExcelApply } from "./excel-apply-plan.js";
import { excelCorrectionRoutes } from "./excel-correction-routes.js";

const audience = "tenant-excel-apply";
const commitBody = z.object({ settings: excelApplySettings, token: z.string().max(2048) }).strict();
const proofSchema = z.object({ tenantId: z.string(), draftId: z.string(), plan: z.string(), settings: z.string() });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const writeModules = { anggota: "members", simpanan: "savings", pinjaman: "loans" } as const;

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required for import confirmation");
  return secret;
}

function planKey(plan: Awaited<ReturnType<typeof planExcelApply>>) {
  return digest([plan.unit, plan.offset, plan.items.filter((item) => item.candidate), plan.total]);
}

function receipt(row: { id: string; createdAt: Date; group: string; result: Prisma.JsonValue }): ExcelApplyReceipt {
  const { count, total, unit, cutoffDate, journalEntryNos } = row.result as Omit<ExcelApplyReceipt, "id" | "createdAt" | "group">;
  return { id: row.id, createdAt: row.createdAt.toISOString(), group: row.group as ExcelApplyReceipt["group"],
    count, total, unit, cutoffDate, journalEntryNos };
}

export function excelApplyRoutes() {
  const router = Router({ mergeParams: true });
  router.use(excelCorrectionRoutes());
  router.get("/", handle(async (req, res) => {
    const { tenantId } = authClaims(req);
    const draftId = requireParam(req, "id");
    const draft = await db.excelImportDraft.findFirst({ where: { tenantId, id: draftId }, select: { balanceDates: true } });
    if (!draft) throw notFound("Draf tidak ditemukan.");
    const [units, receipts] = await Promise.all([
      db.cooperativeUnit.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      db.excelImportReceipt.findMany({ where: { tenantId, draftId }, orderBy: { createdAt: "desc" } })
    ]);
    res.json({ success: true, data: { units, balanceDates: (draft.balanceDates as ExcelBalanceDates | null) ?? {},
      today: dateKey(businessDate()), receipts: receipts.map(receipt) }, meta: res.locals.meta });
  }));

  router.post("/preview", handle(async (req, res) => {
    const { tenantId, userId } = authClaims(req);
    const draftId = requireParam(req, "id");
    const settings = excelApplySettings.parse(req.body);
    const plan = await db.$transaction((tx) => planExcelApply(tx, tenantId, draftId, settings), {
      isolationLevel: "RepeatableRead", timeout: 30000
    });
    const data: ExcelApplyReview = {
      ready: plan.ready, total: plan.total, products: plan.products,
      postingIssue: plan.postingIssue,
      items: plan.items.map(({ name, description, amount, remainingAmount, status, fix }) => ({
        name, description, amount, remainingAmount, status, fix: status === "review" ? fix : undefined
      })),
      token: plan.ready && !plan.postingIssue ? jwt.sign({ tenantId, draftId, settings: digest(settings), plan: planKey(plan) }, signingKey(),
        { audience, subject: userId, expiresIn: "10m" }) : undefined
    };
    res.json({ success: true, data, meta: res.locals.meta });
  }));

  router.post("/commit", (req, res, next) => {
    const { settings } = commitBody.parse(req.body);
    requirePermission(writeModules[settings.group], "create")(req, res, next);
  }, handle(async (req, res) => {
    const { tenantId, userId } = authClaims(req);
    const draftId = requireParam(req, "id");
    const { settings, token } = commitBody.parse(req.body);
    let claims: unknown;
    try { claims = jwt.verify(token, signingKey(), { algorithms: ["HS256"], audience, subject: userId }); }
    catch { throw conflict("Verifikasi kedaluwarsa. Periksa ulang sebelum menerapkan."); }
    const proof = proofSchema.safeParse(claims);
    if (!proof.success || proof.data.tenantId !== tenantId || proof.data.draftId !== draftId || proof.data.settings !== digest(settings)) {
      throw conflict("Pilihan berubah. Periksa ulang sebelum menerapkan.");
    }
    const reviewKey = digest([proof.data.settings, proof.data.plan]);
    const where = { tenantId, draftId, reviewKey };
    const data = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
      const previous = await tx.excelImportReceipt.findFirst({ where });
      if (previous) return receipt(previous);
      const plan = await planExcelApply(tx, tenantId, draftId, settings);
      if (!plan.ready || proof.data.plan !== planKey(plan)) throw conflict("Data tujuan berubah. Periksa ulang sebelum menerapkan.");
      if (plan.postingIssue) throw validationError(plan.postingIssue);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } });
      if (settings.group === "anggota") await assertQuota(tx, tenantId, "MEMBERS", { adding: plan.ready });
      const offset = plan.offset && (plan.offset.id ?? (await tx.account.create({ data: {
        tenantId, code: plan.offset.code, name: plan.offset.name, category: "EKUITAS", normalBalance: "KREDIT",
        equityClass: "EKUITAS_LAIN"
      }, select: { id: true } })).id);
      const journalEntryNos: number[] = [];
      const { unitId } = settings;
      const applied: string[] = [];
      for (const { candidate } of plan.items) {
        if (!candidate) continue;
        if (candidate.group === "anggota") {
          const { birthDate, ...identity } = candidate.identity;
          const member = await tx.member.create({ data: {
            tenantId, ...identity, birthDate: parseDateKey(birthDate),
            memberId: await generateMemberId(tenantId, tenant.slug, tx), accountNumber: await generateAccountNumber(tx)
          }, select: { id: true } });
          await tx.unitMembership.create({ data: { memberId: member.id, unitId } });
          applied.push(member.id);
          continue;
        }
        if (settings.group === "anggota" || !settings.cutoffDate || !offset) throw validationError("Pengaturan saldo awal tidak lengkap.");
        const entryDate = parseDateKey(settings.cutoffDate);
        const amount = new Prisma.Decimal(candidate.amount);
        let sourceId: string;
        const isSaving = candidate.group === "simpanan";
        if (isSaving) {
          const saving = await tx.saving.create({ data: { tenantId, unitId, memberId: candidate.memberId, savingConfigId: candidate.productId,
            balance: amount }, select: { id: true } });
          applied.push(saving.id);
          sourceId = (await tx.savingTransaction.create({ data: { tenantId, savingId: saving.id, type: "DEPOSIT", amount, createdBy: userId,
            createdAt: entryDate, note: "Saldo awal Excel" }, select: { id: true } })).id;
        } else {
          const contract = candidate.contract;
          const overdue = Math.max(0, Math.floor((businessDate().getTime() - parseDateKey(contract.schedule[0]!.dueDate).getTime()) / 86400000));
          const customRate = Number(contract.rate) !== Number(candidate.productRate);
          const loan = await tx.loan.create({ data: {
            tenantId, unitId, memberId: candidate.memberId, loanConfigId: candidate.productId,
            principalAmount: contract.principalAmount, totalAmount: contract.totalAmount, remainingAmount: contract.remainingAmount,
            termMonths: contract.termMonths, monthlyPayment: contract.installmentAmount, installmentAmount: contract.installmentAmount,
            rate: contract.rate, rateNote: customRate ? `Tarif kontrak ${contract.rate}%` : null, disbursedAt: parseDateKey(contract.disbursedAt),
            maturityDate: parseDateKey(contract.schedule.at(-1)!.dueDate), daysOverdue: overdue, kolCategory: getKOLCategory(overdue),
            notes: loanImportNote(contract.contractRef)
          }, select: { id: true } });
          applied.push(loan.id);
          sourceId = loan.id;
          await tx.loanInstallment.createMany({ data: contract.schedule.map((line, i) => ({
            tenantId, loanId: loan.id, seq: i + 1, dueDate: parseDateKey(line.dueDate), principalDue: line.principal, interestDue: line.margin
          })) });
        }
        const entry = await createJournalEntry(tx, {
          tenantId, unitId, entryDate, sourceId, sourceType: isSaving ? "SAVING_TRANSACTION" : "LOAN_DISBURSEMENT",
          entryType: "PENYESUAIAN", createdById: userId, description: "Saldo awal impor Excel",
          lines: [{ accountId: isSaving ? offset : candidate.accountId, debit: amount },
            { accountId: isSaving ? candidate.accountId : offset, credit: amount }]
        });
        journalEntryNos.push(entry.entryNo);
      }
      const result = { count: applied.length, applied, total: plan.total, unit: plan.unit.name, journalEntryNos,
        ...(settings.group === "anggota" || !settings.cutoffDate || !offset ? {} : { cutoffDate: settings.cutoffDate, offsetAccountId: offset }) };
      const saved = await tx.excelImportReceipt.create({ data: { ...where, group: settings.group, result } });
      await recordAudit(tx, { action: "excel.apply", entityType: "ExcelImportReceipt", entityId: saved.id,
        after: { draftId, group: settings.group, count: result.count, total: result.total, unitId, journalEntryNos } });
      return receipt(saved);
    }, { isolationLevel: "Serializable", timeout: 30000 }).catch(async (error: unknown) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      const previous = await db.excelImportReceipt.findFirst({ where });
      if (previous) return receipt(previous);
      throw conflict("Data berubah saat menerapkan. Periksa ulang batch.");
    });
    res.json({ success: true, data, meta: res.locals.meta });
  }));
  return router;
}
