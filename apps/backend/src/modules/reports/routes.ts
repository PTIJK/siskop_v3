import type { LaporanHasilUsaha, Neraca } from "@siskop/types";
import { notFound, validationError } from "../../lib/errors.js";
import { Router, type Request, type Response, type NextFunction } from "express";
import { resolvePeriod } from "../../lib/period.js";
import { resolveReadableUnitId } from "../../lib/unit-access.js";
import { businessDate, dateKey, endOfBusinessDay, parseDateKey } from "../../lib/operating-calendar.js";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { requireAccountingEntitlement, requirePasarEntitlement } from "../../middleware/entitlement.js";
import {
  bukuBesarAccountParamsSchema,
  comparablePeriodParamsSchema,
  exportParamsSchema,
  financialParamsSchema,
  jurnalParamsSchema,
  trialBalanceParamsSchema,
  neracaParamsSchema,
  periodParamsSchema,
  ratParamsSchema,
  rekapHarianKolektorParamsSchema,
  tunggakanAngsuranParamsSchema,
  tunggakanSewaRetribusiParamsSchema,
  unitPeriodParamsSchema,
  upsertCalkNarrativeSchema
} from "./schema.js";
import { getFinancialReport, getRATReport } from "./service.js";
import { BOOK_REPORTS, EXPORT_REPORTS, buildExport, exportFilenameStem, type ExportReport } from "./export-builders.js";
import { renderCsv, renderXlsx } from "./export.js";
import { getBukuBesar, getBukuBesarAccount, getJurnal, getNeracaSaldo, type UnitScope } from "./ledger-service.js";
import { requireParam } from "../../lib/http.js";
import { comparisonAsOf, comparisonRange } from "../../lib/comparison.js";
import { getPerubahanEkuitas } from "./capital-service.js";
import { getRekapHarianKolektor, getTunggakanAngsuran, getTunggakanSewaRetribusi } from "./pasar-service.js";
import { rekapHarianKolektorCsv } from "./pasar-export.js";
import {
  assertValidPeriod,
  getArusKas,
  getCalk,
  getLaporanHasilUsaha,
  getNeraca,
  getShuDistribution,
  upsertCalkNarrative
} from "./regulatory-service.js";
import {
  generateArusKasPdf,
  generateFinancialPdf,
  generateLaporanHasilUsahaPdf,
  generateNeracaPdf,
  generatePerubahanEkuitasPdf,
  generateRatPdf,
  generateShuDistributionPdf
} from "./pdf.js";

/** Forwards rejected promises to the error handler; Express 4 will not. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * The unit a per-unit report is cut to, or undefined for the consolidated one.
 * 404 for a unit that isn't this tenant's, 403 for one outside the caller's
 * assignment; a closed (inactive) unit stays reportable — its history is real.
 */
async function reportUnit(req: Request, unitId?: string): Promise<string | undefined> {
  if (!unitId) return undefined;
  const auth = authClaims(req);
  return resolveReadableUnitId(auth.tenantId, auth.userId, unitId);
}

/**
 * Unit scope for the accounting books: "unallocated" is the unit-less bucket, a cuid is
 * checked like any per-unit report, omitted is the consolidated view.
 */
async function bookUnit(req: Request, unitId?: string): Promise<UnitScope> {
  if (unitId === "unallocated") return null;
  return reportUnit(req, unitId);
}

export function reportsRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  // ── RPT-01 / RPT-02 — aggregate savings/loan summary (pre-ledger) ───────────

  router.get(
    "/financial",
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { startDate, endDate } = financialParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(startDate, endDate);
      const data = await getFinancialReport(authClaims(req).tenantId, { startDate: start, endDate: end });
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/financial/pdf",
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { startDate, endDate } = financialParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(startDate, endDate);
      const pdf = await generateFinancialPdf(authClaims(req).tenantId, { startDate: start, endDate: end });
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="laporan-keuangan-${Date.now()}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/rat",
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { year } = ratParamsSchema.parse(req.query);
      const data = await getRATReport(authClaims(req).tenantId, year);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/rat/pdf",
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { year } = ratParamsSchema.parse(req.query);
      const pdf = await generateRatPdf(authClaims(req).tenantId, year);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="laporan-rat-${year}.pdf"`
      });
      res.send(pdf);
    })
  );

  // ── Laporan Keuangan Regulasi (Permenkop UKM No. 2/2024) ─────────────────────

  router.get(
    "/regulatory/neraca",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { asOfDate, unitId, compare } = neracaParamsSchema.parse(req.query);
      // endOfBusinessDay (Asia/Jakarta), not date-fns's endOfDay (server-local
      // timezone) or a bare `new Date()`: either can put the cutoff hours
      // behind "now" and silently exclude a same-day transaction — see that
      // function's own doc.
      const cutoff = asOfDate ? endOfBusinessDay(new Date(asOfDate)) : endOfBusinessDay();
      const tenantId = authClaims(req).tenantId;
      const unit = await reportUnit(req, unitId);
      const data: Neraca = await getNeraca(tenantId, cutoff, unit);
      if (compare) {
        const earlier = endOfBusinessDay(new Date(comparisonAsOf(compare, dateKey(businessDate(cutoff)))));
        data.comparison = await getNeraca(tenantId, earlier, unit);
      }
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/neraca/pdf",
    requireAccountingEntitlement,
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { asOfDate, unitId } = neracaParamsSchema.parse(req.query);
      // endOfBusinessDay (Asia/Jakarta), not date-fns's endOfDay (server-local
      // timezone) or a bare `new Date()`: either can put the cutoff hours
      // behind "now" and silently exclude a same-day transaction — see that
      // function's own doc.
      const cutoff = asOfDate ? endOfBusinessDay(new Date(asOfDate)) : endOfBusinessDay();
      const pdf = await generateNeracaPdf(authClaims(req).tenantId, cutoff, await reportUnit(req, unitId));
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="neraca-${dateKey(businessDate(cutoff))}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/arus-kas",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { from, to, unitId } = unitPeriodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const data = await getArusKas(authClaims(req).tenantId, start, end, await reportUnit(req, unitId));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/arus-kas/pdf",
    requireAccountingEntitlement,
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { from, to, unitId } = unitPeriodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const pdf = await generateArusKasPdf(authClaims(req).tenantId, start, end, await reportUnit(req, unitId));
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="arus-kas-${dateKey(businessDate(start))}_${dateKey(businessDate(end))}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/laporan-hasil-usaha",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { from, to, unitId, compare } = comparablePeriodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const tenantId = authClaims(req).tenantId;
      const unit = await reportUnit(req, unitId);
      const data: LaporanHasilUsaha = await getLaporanHasilUsaha(tenantId, start, end, unit);
      if (compare) {
        const earlier = comparisonRange(compare, dateKey(businessDate(start)), dateKey(businessDate(end)));
        const p = resolvePeriod(earlier.from, earlier.to);
        data.comparison = await getLaporanHasilUsaha(tenantId, p.start, p.end, unit);
      }
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/laporan-hasil-usaha/pdf",
    requireAccountingEntitlement,
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { from, to, unitId } = unitPeriodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const pdf = await generateLaporanHasilUsahaPdf(authClaims(req).tenantId, start, end, await reportUnit(req, unitId));
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="laporan-hasil-usaha-${dateKey(businessDate(start))}_${dateKey(businessDate(end))}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/perubahan-ekuitas",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { from, to, unitId } = unitPeriodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const data = await getPerubahanEkuitas(authClaims(req).tenantId, start, end, await reportUnit(req, unitId));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/perubahan-ekuitas/pdf",
    requireAccountingEntitlement,
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { from, to, unitId } = unitPeriodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const pdf = await generatePerubahanEkuitasPdf(authClaims(req).tenantId, start, end, await reportUnit(req, unitId));
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="perubahan-ekuitas-${dateKey(businessDate(start))}_${dateKey(businessDate(end))}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/shu-distribution",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const data = await getShuDistribution(authClaims(req).tenantId, start, end);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/shu-distribution/pdf",
    requireAccountingEntitlement,
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const pdf = await generateShuDistributionPdf(authClaims(req).tenantId, start, end);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="shu-distribution-${dateKey(businessDate(start))}_${dateKey(businessDate(end))}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/calk",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const data = await getCalk(authClaims(req).tenantId, start, end);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  // CALK deliberately has no /pdf variant — its narrative sections are
  // edited/reviewed in the UI, not exported as a static PDF (Design Spec §8).
  router.put(
    "/regulatory/calk/narrative",
    requireAccountingEntitlement,
    requirePermission("reports", "update"),
    handle(async (req, res) => {
      const { section, content } = upsertCalkNarrativeSchema.parse(req.body);
      const data = await upsertCalkNarrative(authClaims(req).tenantId, section, content);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  // ── Koperasi pasar plan F7 — Laporan ────────────────────────────────────────

  router.get(
    "/pasar/rekap-kolektor",
    requirePasarEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { date } = rekapHarianKolektorParamsSchema.parse(req.query);
      const data = await getRekapHarianKolektor(authClaims(req).tenantId, date ? parseDateKey(date) : businessDate());
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/pasar/rekap-kolektor/csv",
    requirePasarEntitlement,
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { date } = rekapHarianKolektorParamsSchema.parse(req.query);
      const report = await getRekapHarianKolektor(authClaims(req).tenantId, date ? parseDateKey(date) : businessDate());
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rekap-kolektor-${report.date}.csv"`
      });
      res.send(String.fromCharCode(0xfeff) + rekapHarianKolektorCsv(report));
    })
  );

  router.get(
    "/pasar/tunggakan-angsuran",
    requirePasarEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const query = tunggakanAngsuranParamsSchema.parse(req.query);
      const data = await getTunggakanAngsuran(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/pasar/tunggakan-sewa-retribusi",
    requirePasarEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const query = tunggakanSewaRetribusiParamsSchema.parse(req.query);
      const data = await getTunggakanSewaRetribusi(authClaims(req).tenantId, query);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  // ── Buku akuntansi: Jurnal Umum / Penyesuaian, Neraca Saldo, Buku Besar ───────
  // Same gate as the regulatory statements: accounting package + reports:read.

  router.get(
    "/accounting/jurnal-umum",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const q = jurnalParamsSchema.parse(req.query);
      const { report, total } = await getJurnal(authClaims(req).tenantId, {
        period: resolvePeriod(q.from, q.to),
        unit: await bookUnit(req, q.unitId),
        entryType: q.type,
        sourceType: q.sourceType,
        page: q.page,
        limit: q.limit
      });
      res.json({ success: true, data: report, meta: { ...res.locals.meta, page: q.page, limit: q.limit, total } });
    })
  );

  router.get(
    "/accounting/jurnal-penyesuaian",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const q = jurnalParamsSchema.parse(req.query);
      const { report, total } = await getJurnal(authClaims(req).tenantId, {
        period: resolvePeriod(q.from, q.to),
        unit: await bookUnit(req, q.unitId),
        entryType: "PENYESUAIAN",
        sourceType: q.sourceType,
        page: q.page,
        limit: q.limit
      });
      res.json({ success: true, data: report, meta: { ...res.locals.meta, page: q.page, limit: q.limit, total } });
    })
  );

  router.get(
    "/accounting/neraca-saldo",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const q = trialBalanceParamsSchema.parse(req.query);
      const tenantId = authClaims(req).tenantId;
      const period = resolvePeriod(q.from, q.to);
      const unit = await bookUnit(req, q.unitId);
      const data = await getNeracaSaldo(tenantId, period, unit);
      if (q.compare) {
        const earlier = comparisonRange(q.compare, dateKey(businessDate(period.start)), dateKey(businessDate(period.end)));
        data.comparison = await getNeracaSaldo(tenantId, resolvePeriod(earlier.from, earlier.to), unit);
      }
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/accounting/buku-besar",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const q = trialBalanceParamsSchema.parse(req.query);
      const data = await getBukuBesar(authClaims(req).tenantId, resolvePeriod(q.from, q.to), await bookUnit(req, q.unitId));
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/accounting/buku-besar/:accountId",
    requireAccountingEntitlement,
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const q = bukuBesarAccountParamsSchema.parse(req.query);
      const { report, total } = await getBukuBesarAccount(
        authClaims(req).tenantId,
        requireParam(req, "accountId"),
        resolvePeriod(q.from, q.to),
        await bookUnit(req, q.unitId),
        q.page,
        q.limit
      );
      res.json({ success: true, data: report, meta: { ...res.locals.meta, page: q.page, limit: q.limit, total } });
    })
  );

  // ── Ekspor CSV / XLSX ─────────────────────────────────────────────────────────
  // One endpoint for every accounting report: the same period/unit/as-of parameters as the
  // on-screen report, plus format=csv|xlsx. The accounting package and reports:export gate it.

  router.get(
    "/export/:report",
    requireAccountingEntitlement,
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const report = requireParam(req, "report");
      if (!(EXPORT_REPORTS as readonly string[]).includes(report)) throw notFound("Laporan tidak dikenal");
      const q = exportParamsSchema.parse(req.query);

      const period = resolvePeriod(q.from, q.to);
      assertValidPeriod(period.start, period.end);
      // "unallocated" only means something for the ledger books; the statements have no such view.
      if (q.unitId === "unallocated" && !BOOK_REPORTS.includes(report as ExportReport)) {
        throw validationError("Unit \"tidak dialokasikan\" hanya tersedia untuk buku akuntansi");
      }
      const unit = await bookUnit(req, q.unitId);
      const asOf = q.asOfDate ? endOfBusinessDay(new Date(q.asOfDate)) : endOfBusinessDay();

      const sheet = await buildExport(report as ExportReport, { tenantId: authClaims(req).tenantId, unit, period, asOf, accountId: q.accountId });
      const stem = exportFilenameStem(report as ExportReport, { tenantId: "", unit, period, asOf, accountId: q.accountId });

      if (q.format === "csv") {
        res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.csv"` });
        res.send(renderCsv(sheet));
        return;
      }
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${stem}.xlsx"`
      });
      res.send(await renderXlsx(sheet));
    })
  );

  return router;
}
