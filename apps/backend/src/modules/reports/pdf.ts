import puppeteer from "puppeteer";
import { db } from "../../lib/db.js";
import { getFinancialReport, getRATReport, type ReportParams } from "./service.js";
import {
  getArusKas,
  getLaporanHasilUsaha,
  getNeraca,
  getShuDistribution
} from "./regulatory-service.js";

interface PdfTenant {
  name: string;
  address: string;
  registrationNo: string;
  logoUrl?: string | null;
}

function rp(value: string | number): string {
  return `Rp ${Number(value).toLocaleString("id-ID")}`;
}

/**
 * Blank Ketua/Wakil Ketua/Bendahara signature lines with a place/date line —
 * every RAT-style document in a koperasi's own paper reports ends with this
 * block, signed by hand after printing. Officer names aren't modeled on
 * `Tenant` today, so the lines are intentionally left blank rather than
 * inventing an officer-roster feature here.
 */
function signatureBlockHtml(cityFromAddress: string, asOfDate: string | undefined): string {
  const tanggal = new Date(asOfDate ?? Date.now()).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  return `
    <table style="border:none; margin-top:36px">
      <tr>
        <td style="border:none; width:60%"></td>
        <td style="border:none; text-align:center">${cityFromAddress}, ${tanggal}</td>
      </tr>
    </table>
    <table style="border:none; margin-top:8px">
      <tr>
        <td style="border:none; width:34%; text-align:center">Ketua,</td>
        <td style="border:none; width:32%; text-align:center">Wakil Ketua,</td>
        <td style="border:none; width:34%; text-align:center">Bendahara,</td>
      </tr>
      <tr>
        <td style="border:none; height:60px"></td>
        <td style="border:none"></td>
        <td style="border:none"></td>
      </tr>
      <tr>
        <td style="border:none; text-align:center; border-top:1px solid #222">( .............................. )</td>
        <td style="border:none; text-align:center; border-top:1px solid #222">( .............................. )</td>
        <td style="border:none; text-align:center; border-top:1px solid #222">( .............................. )</td>
      </tr>
    </table>`;
}

/**
 * City for the "Kota, tanggal" line on RAT documents. Tenant addresses follow
 * "Jalan ..., Kota, Provinsi" (see prisma/seed.ts), so the city is the second
 * comma-separated segment, not the last (which is the province).
 */
function cityFromAddress(address: string): string {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[1] ?? parts[0] ?? address;
}

/** Shared page shell — header (logo+nama+alamat) and table styling, reused by
 * every report so PDFs look consistent and are print-ready for RAT handouts.
 * `signature` renders the Ketua/Wakil Ketua/Bendahara block used by RAT-family
 * documents (Laporan RAT, Pembagian SHU); omitted for regulatory statements
 * that aren't RAT handouts (Neraca, Arus Kas, Laporan Hasil Usaha). */
function wrapPdf(
  tenant: PdfTenant,
  title: string,
  subtitle: string,
  bodyHtml: string,
  signature?: { asOfDate: string | undefined }
): string {
  const headerHtml = `
    <div style="display:flex; align-items:center; margin-bottom:16px; border-bottom:2px solid #1e3a5f; padding-bottom:12px">
      ${tenant.logoUrl ? `<img src="${tenant.logoUrl}" style="height:60px; margin-right:16px"/>` : ""}
      <div>
        <h2 style="margin:0; color:#1e3a5f; font-size:18px">${tenant.name}</h2>
        <p style="margin:2px 0; font-size:12px; color:#555">${tenant.address}</p>
        <p style="margin:0; font-size:11px; color:#888">No. Registrasi: ${tenant.registrationNo}</p>
      </div>
    </div>
  `;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; padding: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #1e3a5f; color: white; padding: 8px; text-align: left; }
  td { padding: 6px 8px; border-bottom: 1px solid #e0e0e0; }
  tr:nth-child(even) td { background: #f5f5f5; }
  tr.total td { font-weight: bold; border-top: 2px solid #1e3a5f; }
  h3 { color: #1e3a5f; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .catatan { padding: 12px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 4px; }
</style></head>
<body>
${headerHtml}
<h2 style="text-align:center; color:#1e3a5f">${title}</h2>
<p style="text-align:center; color:#555">${subtitle}</p>
${bodyHtml}
${signature ? signatureBlockHtml(cityFromAddress(tenant.address), signature.asOfDate) : ""}
</body></html>`;
}

async function renderToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "25mm", left: "15mm", right: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `
        <div style="font-size:10px; width:100%; text-align:center; color:#666; padding:5px">
          Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span>
        </div>
      `
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function requireTenant(tenantId: string): Promise<PdfTenant> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Tenant tidak ditemukan");
  return tenant;
}

// ── RPT-01 / RPT-02 ──────────────────────────────────────────────────────────

export async function generateFinancialPdf(tenantId: string, params: ReportParams): Promise<Buffer> {
  const tenant = await requireTenant(tenantId);
  const data = await getFinancialReport(tenantId, params);

  const body = `
<h3>Rekap Simpanan per Jenis</h3>
<table><tr><th>Jenis</th><th>Tipe</th><th>Jumlah Rekening</th><th>Total Saldo</th></tr>
${data.simpananPerJenis.map((s) => `<tr><td>${s.name}</td><td>${s.type}</td><td>${s.count}</td><td>${rp(s.totalBalance)}</td></tr>`).join("")}
</table>
<h3>Transaksi Simpanan</h3>
<table>
  <tr><th>Jenis</th><th>Jumlah Transaksi</th><th>Total Nominal</th></tr>
  <tr><td>Setoran</td><td>${data.transaksiSimpanan.deposit.count}</td><td>${rp(data.transaksiSimpanan.deposit.total)}</td></tr>
  <tr><td>Penarikan</td><td>${data.transaksiSimpanan.withdrawal.count}</td><td>${rp(data.transaksiSimpanan.withdrawal.total)}</td></tr>
</table>
<h3>Pinjaman</h3>
<table>
  <tr><th>Keterangan</th><th>Jumlah</th><th>Total Nominal</th></tr>
  <tr><td>Pinjaman Dicairkan</td><td>${data.pinjaman.dicairkan.count}</td><td>${rp(data.pinjaman.dicairkan.total)}</td></tr>
  <tr><td>Angsuran Diterima</td><td>${data.pinjaman.angsuranDiterima.count}</td><td>${rp(data.pinjaman.angsuranDiterima.total)}</td></tr>
</table>
<h3>Ringkasan</h3>
<table>
  <tr class="total"><td>Saldo Akhir Simpanan</td><td>${rp(data.saldoAkhirSimpanan)}</td></tr>
  <tr class="total"><td>Sisa Pinjaman Outstanding</td><td>${rp(data.sisaPinjamanOutstanding)}</td></tr>
</table>`;

  return renderToPdf(wrapPdf(tenant, "Laporan Keuangan", `Periode: ${data.periode.start} s/d ${data.periode.end}`, body));
}

export async function generateRatPdf(tenantId: string, year: number): Promise<Buffer> {
  const tenant = await requireTenant(tenantId);
  const data = await getRATReport(tenantId, year);

  const body = `
<h3>Keanggotaan</h3>
<table>
  <tr><td>Anggota Awal Tahun</td><td>${data.keanggotaan.awalTahun} orang</td></tr>
  <tr><td>Anggota Akhir Tahun</td><td>${data.keanggotaan.akhirTahun} orang</td></tr>
  <tr><td>Pertumbuhan</td><td>${data.keanggotaan.pertumbuhan} orang</td></tr>
</table>
<h3>Simpanan</h3>
<table><tr><th>Jenis</th><th>Jumlah Rekening</th><th>Total Saldo</th></tr>
${data.simpanan.map((s) => `<tr><td>${s.jenis}</td><td>${s.jumlahRekening}</td><td>${rp(s.totalSaldo)}</td></tr>`).join("")}
</table>
<h3>Pinjaman</h3>
<table>
  <tr><td>Pinjaman Diberikan</td><td>${data.pinjaman.diberikan.count} pinjaman</td><td>${rp(data.pinjaman.diberikan.total)}</td></tr>
  <tr><td>Pinjaman Lunas</td><td>${data.pinjaman.lunas} pinjaman</td><td>—</td></tr>
</table>
<h3>Distribusi KOL (Kualitas Pinjaman)</h3>
<table><tr><th>Kategori</th><th>Jumlah</th><th>Persentase</th></tr>
${data.kolDistribution.map((k) => `<tr><td>${k.category}</td><td>${k.count}</td><td>${k.percentage}</td></tr>`).join("")}
</table>`;

  return renderToPdf(
    wrapPdf(tenant, "Laporan RAT (Rapat Anggota Tahunan)", `Tahun ${year}`, body, { asOfDate: `${year}-12-31` })
  );
}

// ── Regulatory (Permenkop UKM No. 2/2024) ────────────────────────────────────

export async function generateNeracaPdf(tenantId: string, asOfDate: Date): Promise<Buffer> {
  const tenant = await requireTenant(tenantId);
  const data = await getNeraca(tenantId, asOfDate);

  const section = (label: string, s: { items: Array<{ code: string | null; name: string; balance: string; isComputed: boolean }>; total: string }) => `
    <h3>${label}</h3>
    <table><tr><th>Kode</th><th>Nama Akun</th><th>Saldo</th></tr>
    ${s.items.map((i) => `<tr><td>${i.code ?? "-"}</td><td>${i.name}${i.isComputed ? " <i>(dihitung otomatis)</i>" : ""}</td><td>${rp(i.balance)}</td></tr>`).join("")}
    <tr class="total"><td colspan="2">Total ${label}</td><td>${rp(s.total)}</td></tr>
    </table>`;
  const body = `
    ${section("Aset", data.aset)}
    ${section("Kewajiban", data.kewajiban)}
    ${section("Ekuitas", data.ekuitas)}
    <table><tr class="total"><td>Total Kewajiban dan Ekuitas</td><td>${rp(data.totalKewajibanDanEkuitas)}</td></tr></table>
    <p style="text-align:center; color:${data.balanced ? "#2e7d32" : "#c62828"}">
      ${data.balanced ? "Aset = Kewajiban + Ekuitas (seimbang)" : "PERINGATAN: neraca tidak seimbang"}
    </p>`;

  return renderToPdf(wrapPdf(tenant, "Neraca (Laporan Posisi Keuangan)", `Per Tanggal ${data.asOfDate}`, body));
}

export async function generateArusKasPdf(tenantId: string, from: Date, to: Date): Promise<Buffer> {
  const tenant = await requireTenant(tenantId);
  const data = await getArusKas(tenantId, from, to);
  const subtitle = `Periode ${data.periode.from} s/d ${data.periode.to}`;

  if (data.catatan) {
    return renderToPdf(wrapPdf(tenant, "Laporan Arus Kas", subtitle, `<div class="catatan">${data.catatan}</div>`));
  }

  const activity = (label: string, a: { rincian: Array<{ label: string; amount: string }>; total: string }) => `
    <h3>${label}</h3>
    <table><tr><th>Keterangan</th><th>Nominal</th></tr>
    ${a.rincian.map((r) => `<tr><td>${r.label}</td><td>${rp(r.amount)}</td></tr>`).join("") || '<tr><td colspan="2">Tidak ada aktivitas</td></tr>'}
    <tr class="total"><td>Total ${label}</td><td>${rp(a.total)}</td></tr>
    </table>`;
  const body = `
    <table><tr><td>Saldo Kas Awal Periode</td><td>${rp(data.saldoKasAwal)}</td></tr></table>
    ${activity("Aktivitas Operasi", data.aktivitasOperasi)}
    ${activity("Aktivitas Investasi", data.aktivitasInvestasi)}
    ${activity("Aktivitas Pendanaan", data.aktivitasPendanaan)}
    <table>
      <tr class="total"><td>Kenaikan (Penurunan) Kas Bersih</td><td>${rp(data.kenaikanPenurunanKasBersih)}</td></tr>
      <tr class="total"><td>Saldo Kas Akhir Periode</td><td>${rp(data.saldoKasAkhir)}</td></tr>
    </table>
    <p style="text-align:center; color:${data.balanced ? "#2e7d32" : "#c62828"}">
      ${data.balanced ? "Rekonsiliasi kas sesuai buku besar" : "PERINGATAN: saldo kas tidak sesuai buku besar"}
    </p>`;

  return renderToPdf(wrapPdf(tenant, "Laporan Arus Kas", subtitle, body));
}

export async function generateLaporanHasilUsahaPdf(tenantId: string, from: Date, to: Date): Promise<Buffer> {
  const tenant = await requireTenant(tenantId);
  const data = await getLaporanHasilUsaha(tenantId, from, to);

  const section = (label: string, s: { items: Array<{ code: string | null; name: string; total: string }>; total: string }) => `
    <h3>${label}</h3>
    <table><tr><th>Kode</th><th>Nama Akun</th><th>Nominal</th></tr>
    ${s.items.map((i) => `<tr><td>${i.code ?? "-"}</td><td>${i.name}</td><td>${rp(i.total)}</td></tr>`).join("") || '<tr><td colspan="3">Tidak ada data</td></tr>'}
    <tr class="total"><td colspan="2">Total ${label}</td><td>${rp(s.total)}</td></tr>
    </table>`;
  const body = `
    ${section("Pendapatan", data.pendapatan)}
    ${section("Beban", data.beban)}
    <table><tr class="total"><td>Sisa Hasil Usaha (SHU) Periode Berjalan</td><td>${rp(data.shuBerjalan)}</td></tr></table>`;

  return renderToPdf(
    wrapPdf(tenant, "Laporan Perhitungan Hasil Usaha", `Periode ${data.periode.from} s/d ${data.periode.to}`, body)
  );
}

export async function generateShuDistributionPdf(tenantId: string, from: Date, to: Date): Promise<Buffer> {
  const tenant = await requireTenant(tenantId);
  const data = await getShuDistribution(tenantId, from, to);
  const subtitle = `Periode ${data.periode.from} s/d ${data.periode.to}`;

  if (data.catatan) {
    return renderToPdf(wrapPdf(tenant, "Daftar Pembagian SHU per Anggota", subtitle, `<div class="catatan">${data.catatan}</div>`));
  }

  const alokasi = data.alokasi!;
  const body = `
    <table><tr class="total"><td>SHU Periode Berjalan</td><td>${rp(data.shuBerjalan)}</td></tr></table>
    <h3>Alokasi SHU</h3>
    <table>
      <tr><th>Pos</th><th>Persentase</th><th>Nominal</th></tr>
      <tr><td>Jasa Simpanan</td><td>${alokasi.jasaSimpanan.percent}%</td><td>${rp(alokasi.jasaSimpanan.total)}</td></tr>
      <tr><td>Jasa Pinjaman</td><td>${alokasi.jasaPinjaman.percent}%</td><td>${rp(alokasi.jasaPinjaman.total)}</td></tr>
      <tr><td>Cadangan</td><td>${alokasi.cadangan.percent}%</td><td>${rp(alokasi.cadangan.total)}</td></tr>
      <tr><td>Lainnya</td><td>${alokasi.lainnya.percent}%</td><td>${rp(alokasi.lainnya.total)}</td></tr>
    </table>
    <h3>Pembagian per Anggota</h3>
    <table>
      <tr><th>No</th><th>No Anggota</th><th>Nama</th><th>SHU Pokok/SW</th><th>SHU Sukarela</th><th>SHU Pinjaman</th><th>Total SHU</th></tr>
      ${data.anggota
        .map(
          (a) =>
            `<tr><td>${a.no}</td><td>${a.memberCode}</td><td>${a.fullName}</td><td>${rp(a.shuPokokWajib)}</td><td>${rp(a.shuSukarela)}</td><td>${rp(a.jasaPinjaman)}</td><td>${rp(a.totalShu)}</td></tr>`
        )
        .join("") || '<tr><td colspan="7">Tidak ada anggota aktif</td></tr>'}
      <tr class="total"><td colspan="6">Total Dibagikan ke Anggota</td><td>${rp(data.totalDibagikanKeAnggota ?? "0")}</td></tr>
    </table>`;

  return renderToPdf(wrapPdf(tenant, "Daftar Pembagian SHU per Anggota", subtitle, body, { asOfDate: data.periode.to }));
}
