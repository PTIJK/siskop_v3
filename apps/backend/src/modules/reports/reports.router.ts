import { Router } from 'express';
import { requirePermission } from '../../middleware/rbac.middleware';
import { requireAccountingEntitlement } from '../../middleware/entitlement.middleware';
import {
  getFinancialReport,
  downloadFinancialPDF,
  getRATReport,
  downloadRATPDF,
} from './reports.controller';
import {
  getNeraca,
  getArusKas,
  getLaporanHasilUsaha,
  getShuDistributionReport,
  getCalk,
  upsertCalkNarrative,
  downloadNeracaPDF,
  downloadArusKasPDF,
  downloadLaporanHasilUsahaPDF,
  downloadShuDistributionPDF,
} from './regulatory-reports.controller';

export const reportsRouter = Router();

reportsRouter.get('/financial', requirePermission('reports', 'read'), getFinancialReport);
reportsRouter.get('/financial/pdf', requirePermission('reports', 'export'), downloadFinancialPDF);
reportsRouter.get('/rat', requirePermission('reports', 'read'), getRATReport);
reportsRouter.get('/rat/pdf', requirePermission('reports', 'export'), downloadRATPDF);

// Laporan Keuangan Regulasi (Permenkop 2/2024) — gated by the "accounting" entitlement,
// same as Konfigurasi Akun (Design Spec 2026-07-22-pelaporan-regulasi §10).
reportsRouter.get(
  '/regulatory/neraca',
  requireAccountingEntitlement,
  requirePermission('reports', 'read'),
  getNeraca
);
reportsRouter.get(
  '/regulatory/neraca/pdf',
  requireAccountingEntitlement,
  requirePermission('reports', 'export'),
  downloadNeracaPDF
);
reportsRouter.get(
  '/regulatory/arus-kas',
  requireAccountingEntitlement,
  requirePermission('reports', 'read'),
  getArusKas
);
reportsRouter.get(
  '/regulatory/arus-kas/pdf',
  requireAccountingEntitlement,
  requirePermission('reports', 'export'),
  downloadArusKasPDF
);
reportsRouter.get(
  '/regulatory/laporan-hasil-usaha',
  requireAccountingEntitlement,
  requirePermission('reports', 'read'),
  getLaporanHasilUsaha
);
reportsRouter.get(
  '/regulatory/laporan-hasil-usaha/pdf',
  requireAccountingEntitlement,
  requirePermission('reports', 'export'),
  downloadLaporanHasilUsahaPDF
);
reportsRouter.get(
  '/regulatory/shu-distribution',
  requireAccountingEntitlement,
  requirePermission('reports', 'read'),
  getShuDistributionReport
);
reportsRouter.get(
  '/regulatory/shu-distribution/pdf',
  requireAccountingEntitlement,
  requirePermission('reports', 'export'),
  downloadShuDistributionPDF
);
reportsRouter.get(
  '/regulatory/calk',
  requireAccountingEntitlement,
  requirePermission('reports', 'read'),
  getCalk
);
reportsRouter.put(
  '/regulatory/calk/narrative',
  requireAccountingEntitlement,
  requirePermission('reports', 'update'),
  upsertCalkNarrative
);
