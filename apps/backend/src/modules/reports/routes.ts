import { Router, type Request, type Response, type NextFunction } from "express";
import { endOfDay, endOfMonth, startOfMonth } from "date-fns";
import { authClaims, requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import {
  financialParamsSchema,
  neracaParamsSchema,
  periodParamsSchema,
  ratParamsSchema,
  upsertCalkNarrativeSchema
} from "./schema.js";
import { getFinancialReport, getRATReport } from "./service.js";
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
 * An explicit date-string query param used as an inclusive upper bound must be
 * widened to the end of that calendar day — `new Date('2026-07-26')` is UTC
 * midnight, so without this any row created later that same day is silently
 * excluded (see siskop-v3-date-range-endpoint-bug-class memory / BUG-3 in the
 * pre-rescaffold QA cycle). Lower bounds are fine as raw `new Date(...)`.
 */
function resolvePeriod(from?: string, to?: string): { start: Date; end: Date } {
  return {
    start: from ? new Date(from) : startOfMonth(new Date()),
    end: to ? endOfDay(new Date(to)) : endOfMonth(new Date())
  };
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
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { asOfDate } = neracaParamsSchema.parse(req.query);
      const cutoff = asOfDate ? endOfDay(new Date(asOfDate)) : new Date();
      const data = await getNeraca(authClaims(req).tenantId, cutoff);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/neraca/pdf",
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { asOfDate } = neracaParamsSchema.parse(req.query);
      const cutoff = asOfDate ? endOfDay(new Date(asOfDate)) : new Date();
      const pdf = await generateNeracaPdf(authClaims(req).tenantId, cutoff);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="neraca-${cutoff.toISOString().split("T")[0]}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/arus-kas",
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const data = await getArusKas(authClaims(req).tenantId, start, end);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/arus-kas/pdf",
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const pdf = await generateArusKasPdf(authClaims(req).tenantId, start, end);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="arus-kas-${start.toISOString().split("T")[0]}_${end.toISOString().split("T")[0]}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/laporan-hasil-usaha",
    requirePermission("reports", "read"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const data = await getLaporanHasilUsaha(authClaims(req).tenantId, start, end);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  router.get(
    "/regulatory/laporan-hasil-usaha/pdf",
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const pdf = await generateLaporanHasilUsahaPdf(authClaims(req).tenantId, start, end);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="laporan-hasil-usaha-${start.toISOString().split("T")[0]}_${end.toISOString().split("T")[0]}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/shu-distribution",
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
    requirePermission("reports", "export"),
    handle(async (req, res) => {
      const { from, to } = periodParamsSchema.parse(req.query);
      const { start, end } = resolvePeriod(from, to);
      assertValidPeriod(start, end);
      const pdf = await generateShuDistributionPdf(authClaims(req).tenantId, start, end);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="shu-distribution-${start.toISOString().split("T")[0]}_${end.toISOString().split("T")[0]}.pdf"`
      });
      res.send(pdf);
    })
  );

  router.get(
    "/regulatory/calk",
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
    requirePermission("reports", "update"),
    handle(async (req, res) => {
      const { section, content } = upsertCalkNarrativeSchema.parse(req.body);
      const data = await upsertCalkNarrative(authClaims(req).tenantId, section, content);
      res.json({ success: true, data, meta: res.locals.meta });
    })
  );

  return router;
}
