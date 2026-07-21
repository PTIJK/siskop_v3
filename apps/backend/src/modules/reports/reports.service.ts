import { startOfYear, endOfYear, startOfMonth, endOfMonth } from 'date-fns';
import puppeteer from 'puppeteer';
import prisma from '../../lib/prisma';

export interface ReportParams {
  startDate?: string;
  endDate?: string;
  year?: number;
}

export class ReportsService {
  async getFinancialReport(tenantId: string, params: ReportParams) {
    const start = params.startDate ? new Date(params.startDate) : startOfMonth(new Date());
    const end = params.endDate ? new Date(params.endDate) : endOfMonth(new Date());

    const [savingsByType, depositTotal, withdrawalTotal, loansDisburased, paymentsReceived, savingBalance, loanOutstanding] =
      await Promise.all([
        // Total per jenis simpanan
        prisma.savingConfig.findMany({
          where: { tenantId },
          include: {
            savings: {
              where: { tenantId, isActive: true },
              select: { balance: true },
            },
          },
        }),

        // Total deposit dalam periode
        prisma.savingTransaction.aggregate({
          where: { tenantId, type: 'DEPOSIT', createdAt: { gte: start, lte: end } },
          _sum: { amount: true },
          _count: true,
        }),

        // Total withdrawal dalam periode
        prisma.savingTransaction.aggregate({
          where: { tenantId, type: 'WITHDRAWAL', createdAt: { gte: start, lte: end } },
          _sum: { amount: true },
          _count: true,
        }),

        // Total pinjaman dicairkan dalam periode
        prisma.loan.aggregate({
          where: { tenantId, disbursedAt: { gte: start, lte: end } },
          _sum: { principalAmount: true },
          _count: true,
        }),

        // Total angsuran dalam periode
        prisma.loanPayment.aggregate({
          where: { tenantId, paidAt: { gte: start, lte: end } },
          _sum: { amount: true, penalty: true },
          _count: true,
        }),

        // Saldo akhir simpanan
        prisma.saving.aggregate({
          where: { tenantId, isActive: true },
          _sum: { balance: true },
        }),

        // Outstanding pinjaman
        prisma.loan.aggregate({
          where: { tenantId, status: 'ACTIVE' },
          _sum: { remainingAmount: true },
        }),
      ]);

    const simpananPerJenis = savingsByType.map((config) => ({
      name: config.name,
      type: config.type,
      totalBalance: config.savings
        .reduce((sum, s) => sum + Number(s.balance), 0)
        .toString(),
      count: config.savings.length,
    }));

    return {
      periode: { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] },
      simpananPerJenis,
      transaksiSimpanan: {
        deposit: { total: (depositTotal._sum.amount ?? 0).toString(), count: depositTotal._count },
        withdrawal: {
          total: (withdrawalTotal._sum.amount ?? 0).toString(),
          count: withdrawalTotal._count,
        },
      },
      pinjaman: {
        dicairkan: {
          total: (loansDisburased._sum.principalAmount ?? 0).toString(),
          count: loansDisburased._count,
        },
        angsuranDiterima: {
          total: (paymentsReceived._sum.amount ?? 0).toString(),
          totalDenda: (paymentsReceived._sum.penalty ?? 0).toString(),
          count: paymentsReceived._count,
        },
      },
      saldoAkhirSimpanan: (savingBalance._sum.balance ?? 0).toString(),
      sisaPinjamanOutstanding: (loanOutstanding._sum.remainingAmount ?? 0).toString(),
    };
  }

  async getRATReport(tenantId: string, year: number) {
    const yearStart = startOfYear(new Date(year, 0, 1));
    const yearEnd = endOfYear(new Date(year, 11, 31));

    const [membersStart, membersEnd, savingGrowth, loansGiven, loansCompleted, kolDist] =
      await Promise.all([
        prisma.member.count({
          where: { tenantId, createdAt: { lt: yearStart }, isActive: true },
        }),
        prisma.member.count({ where: { tenantId, isActive: true } }),
        prisma.savingConfig.findMany({
          where: { tenantId },
          include: {
            savings: {
              where: { tenantId, isActive: true },
              select: { balance: true, createdAt: true },
            },
          },
        }),
        prisma.loan.aggregate({
          where: { tenantId, disbursedAt: { gte: yearStart, lte: yearEnd } },
          _sum: { principalAmount: true },
          _count: true,
        }),
        prisma.loan.count({
          where: { tenantId, status: 'COMPLETED', updatedAt: { gte: yearStart, lte: yearEnd } },
        }),
        prisma.loan.groupBy({
          by: ['kolCategory'],
          where: { tenantId, status: 'ACTIVE' },
          _count: true,
        }),
      ]);

    const totalActiveLoans = kolDist.reduce((sum, k) => sum + k._count, 0);
    const kolDistribution = kolDist.map((k) => ({
      category: k.kolCategory,
      count: k._count,
      percentage:
        totalActiveLoans > 0
          ? ((k._count / totalActiveLoans) * 100).toFixed(1) + '%'
          : '0%',
    }));

    return {
      tahun: year,
      keanggotaan: { awalTahun: membersStart, akhirTahun: membersEnd, pertumbuhan: membersEnd - membersStart },
      simpanan: savingGrowth.map((cfg) => ({
        jenis: cfg.name,
        type: cfg.type,
        totalSaldo: cfg.savings.reduce((sum, s) => sum + Number(s.balance), 0).toString(),
        jumlahRekening: cfg.savings.length,
      })),
      pinjaman: {
        diberikan: { total: (loansGiven._sum.principalAmount ?? 0).toString(), count: loansGiven._count },
        lunas: loansCompleted,
      },
      kolDistribution,
    };
  }

  async generatePDF(tenantId: string, reportType: 'financial' | 'rat', params: ReportParams): Promise<Buffer> {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant tidak ditemukan');

    const data =
      reportType === 'financial'
        ? await this.getFinancialReport(tenantId, params)
        : await this.getRATReport(tenantId, params.year ?? new Date().getFullYear());

    const html = this.renderTemplate(reportType, tenant, data);

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '25mm', left: '15mm', right: '15mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `
          <div style="font-size:10px; width:100%; text-align:center; color:#666; padding:5px">
            ${tenant.name} &nbsp;|&nbsp; Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span>
          </div>
        `,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private renderTemplate(
    type: 'financial' | 'rat',
    tenant: { name: string; address: string; registrationNo: string; logoUrl?: string | null },
    data: unknown
  ): string {
    const d = data as Record<string, unknown>;
    const headerHtml = `
      <div style="display:flex; align-items:center; margin-bottom:16px; border-bottom:2px solid #1e3a5f; padding-bottom:12px">
        ${tenant.logoUrl ? `<img src="${tenant.logoUrl}" style="height:60px; margin-right:16px"/>` : ''}
        <div>
          <h2 style="margin:0; color:#1e3a5f; font-size:18px">${tenant.name}</h2>
          <p style="margin:2px 0; font-size:12px; color:#555">${tenant.address}</p>
          <p style="margin:0; font-size:11px; color:#888">No. Registrasi: ${tenant.registrationNo}</p>
        </div>
      </div>
    `;

    if (type === 'financial') {
      return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; padding: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #1e3a5f; color: white; padding: 8px; text-align: left; }
  td { padding: 6px 8px; border-bottom: 1px solid #e0e0e0; }
  tr:nth-child(even) td { background: #f5f5f5; }
  h3 { color: #1e3a5f; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
</style></head>
<body>
${headerHtml}
<h2 style="text-align:center; color:#1e3a5f">Laporan Keuangan</h2>
<p style="text-align:center; color:#555">Periode: ${(d as {periode?: {start?: string; end?: string}}).periode?.start ?? ''} s/d ${(d as {periode?: {start?: string; end?: string}}).periode?.end ?? ''}</p>
<h3>Rekap Simpanan per Jenis</h3>
<table><tr><th>Jenis</th><th>Tipe</th><th>Jumlah Rekening</th><th>Total Saldo</th></tr>
${((d as {simpananPerJenis?: Array<{name?: string; type?: string; count?: number; totalBalance?: string}>}).simpananPerJenis ?? []).map((s) => `
  <tr><td>${s.name ?? ''}</td><td>${s.type ?? ''}</td><td>${s.count ?? 0}</td><td>Rp ${Number(s.totalBalance ?? 0).toLocaleString('id-ID')}</td></tr>
`).join('')}
</table>
<h3>Transaksi Simpanan</h3>
<table>
  <tr><th>Jenis</th><th>Jumlah Transaksi</th><th>Total Nominal</th></tr>
  <tr><td>Setoran</td><td>${((d as {transaksiSimpanan?: {deposit?: {count?: number}}}).transaksiSimpanan?.deposit?.count ?? 0)}</td><td>Rp ${Number((d as {transaksiSimpanan?: {deposit?: {total?: string}}}).transaksiSimpanan?.deposit?.total ?? 0).toLocaleString('id-ID')}</td></tr>
  <tr><td>Penarikan</td><td>${((d as {transaksiSimpanan?: {withdrawal?: {count?: number}}}).transaksiSimpanan?.withdrawal?.count ?? 0)}</td><td>Rp ${Number((d as {transaksiSimpanan?: {withdrawal?: {total?: string}}}).transaksiSimpanan?.withdrawal?.total ?? 0).toLocaleString('id-ID')}</td></tr>
</table>
<h3>Pinjaman</h3>
<table>
  <tr><th>Keterangan</th><th>Jumlah</th><th>Total Nominal</th></tr>
  <tr><td>Pinjaman Dicairkan</td><td>${((d as {pinjaman?: {dicairkan?: {count?: number}}}).pinjaman?.dicairkan?.count ?? 0)}</td><td>Rp ${Number((d as {pinjaman?: {dicairkan?: {total?: string}}}).pinjaman?.dicairkan?.total ?? 0).toLocaleString('id-ID')}</td></tr>
  <tr><td>Angsuran Diterima</td><td>${((d as {pinjaman?: {angsuranDiterima?: {count?: number}}}).pinjaman?.angsuranDiterima?.count ?? 0)}</td><td>Rp ${Number((d as {pinjaman?: {angsuranDiterima?: {total?: string}}}).pinjaman?.angsuranDiterima?.total ?? 0).toLocaleString('id-ID')}</td></tr>
</table>
<h3>Ringkasan</h3>
<table>
  <tr><td><b>Saldo Akhir Simpanan</b></td><td>Rp ${Number((d as {saldoAkhirSimpanan?: string}).saldoAkhirSimpanan ?? 0).toLocaleString('id-ID')}</td></tr>
  <tr><td><b>Sisa Pinjaman Outstanding</b></td><td>Rp ${Number((d as {sisaPinjamanOutstanding?: string}).sisaPinjamanOutstanding ?? 0).toLocaleString('id-ID')}</td></tr>
</table>
</body></html>`;
    }

    // RAT report
    const rat = d as {
      tahun?: number;
      keanggotaan?: { awalTahun?: number; akhirTahun?: number; pertumbuhan?: number };
      simpanan?: Array<{ jenis?: string; type?: string; jumlahRekening?: number; totalSaldo?: string }>;
      pinjaman?: { diberikan?: { count?: number; total?: string }; lunas?: number };
      kolDistribution?: Array<{ category?: string; count?: number; percentage?: string }>;
    };
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; padding: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #1e3a5f; color: white; padding: 8px; text-align: left; }
  td { padding: 6px 8px; border-bottom: 1px solid #e0e0e0; }
  tr:nth-child(even) td { background: #f5f5f5; }
  h3 { color: #1e3a5f; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
</style></head>
<body>
${headerHtml}
<h2 style="text-align:center; color:#1e3a5f">Laporan RAT (Rapat Anggota Tahunan)</h2>
<p style="text-align:center; color:#555">Tahun ${rat.tahun ?? ''}</p>
<h3>Keanggotaan</h3>
<table>
  <tr><td>Anggota Awal Tahun</td><td>${rat.keanggotaan?.awalTahun ?? 0} orang</td></tr>
  <tr><td>Anggota Akhir Tahun</td><td>${rat.keanggotaan?.akhirTahun ?? 0} orang</td></tr>
  <tr><td>Pertumbuhan</td><td>${rat.keanggotaan?.pertumbuhan ?? 0} orang</td></tr>
</table>
<h3>Simpanan</h3>
<table><tr><th>Jenis</th><th>Jumlah Rekening</th><th>Total Saldo</th></tr>
${(rat.simpanan ?? []).map((s) => `<tr><td>${s.jenis ?? ''}</td><td>${s.jumlahRekening ?? 0}</td><td>Rp ${Number(s.totalSaldo ?? 0).toLocaleString('id-ID')}</td></tr>`).join('')}
</table>
<h3>Pinjaman</h3>
<table>
  <tr><td>Pinjaman Diberikan</td><td>${rat.pinjaman?.diberikan?.count ?? 0} pinjaman</td><td>Rp ${Number(rat.pinjaman?.diberikan?.total ?? 0).toLocaleString('id-ID')}</td></tr>
  <tr><td>Pinjaman Lunas</td><td>${rat.pinjaman?.lunas ?? 0} pinjaman</td><td>—</td></tr>
</table>
<h3>Distribusi KOL (Kualitas Pinjaman)</h3>
<table><tr><th>Kategori</th><th>Jumlah</th><th>Persentase</th></tr>
${(rat.kolDistribution ?? []).map((k) => `<tr><td>${k.category ?? ''}</td><td>${k.count ?? 0}</td><td>${k.percentage ?? '0%'}</td></tr>`).join('')}
</table>
</body></html>`;
  }
}

export const reportsService = new ReportsService();
