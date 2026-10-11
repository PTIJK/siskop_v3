# Research: Koperasi Pasar (KOPPAS) — Gap Analysis & MVP

> Tanggal: 2026-09-26 · Konteks: SISKOP v3 (`claude/busy-ramanujan-cujt2s`) · Depth: medium
> (riset web lewat hasil pencarian; beberapa sumber primer — teks Permenkop, jurnal — tidak bisa
> dibuka langsung dari environment ini, jadi angka regulasi dikutip dari ringkasan sekunder dan
> dicocokkan dengan `lib/regulatory-config.ts` yang sudah ada.)

## Executive Summary

Koperasi pasar (KOPPAS) adalah koperasi yang anggotanya **pedagang pasar**. Bentuk yang paling
umum di lapangan adalah **simpan pinjam**, dengan ciri operasional yang berbeda dari KSP kantor:
pinjaman modal dagang dengan **angsuran harian/mingguan**, dan **petugas (juru tagih/kolektor)
yang mendatangi lapak setiap hari** untuk menagih angsuran dan menjemput tabungan. Pesaing
langsungnya adalah rentenir/"bank keliling" yang menang di kecepatan dan kemudahan, bukan harga.

SISKOP saat ini sudah menutup fondasinya (anggota, simpanan, pinjaman, jurnal otomatis, KSU
multi-unit, toko/POS, batas regulasi 24%/9%/BMPP). Tetapi **inti operasional KOPPAS belum
tertangani**: model pinjaman hanya mengenal angsuran **bulanan**, KOL dihitung per bulan, dan
tidak ada konsep **kolektor** maupun **setoran kas kolektor** — padahal penggelapan setoran oleh
kolektor adalah risiko fraud yang paling sering muncul di koperasi jenis ini.

**MVP yang direkomendasikan: "KOPPAS Simpan Pinjam + Kolektor"** — (1) frekuensi angsuran
harian/mingguan dengan jadwal angsuran nyata, (2) KOL berbasis jadwal, (3) peran kolektor +
daftar tagih harian + batch setoran kas yang diverifikasi teller, (4) layar kolektor di aplikasi
mobile (online), (5) profil lapak pedagang, (6) laporan rekap harian kolektor. Pengelolaan
kios/sewa/retribusi, mode offline, dan QRIS **ditunda** ke fase berikutnya.

---

## 1. Temuan Riset

### 1.1 Profil KOPPAS
- Anggota = pedagang pasar; tujuan menyediakan permodalan, gudang, dan layanan logistik untuk
  anggota. Bentuk bisa produsen, simpan pinjam, atau serba usaha, tetapi **yang paling umum
  adalah simpan pinjam**. ([Koperasi Pasar (KOPPAS)](https://rizqalmaas.blogspot.com/2018/10/koperasi-pasar-koppas.html))
- Pengurus **mendatangi pedagang untuk menawarkan pinjaman dan menagih setiap hari**, agar
  pedagang bisa mencicil tanpa terbebani. ([idem](https://rizqalmaas.blogspot.com/2018/10/koperasi-pasar-koppas.html),
  [Koperasi Pasar sebagai sarana meminimalisir rentenir — UM Metro](https://ojs.fkip.ummetro.ac.id/index.php/ekonomi/article/download/3314/1534))
- Produk yang ditemukan di pasar: pinjaman modal usaha, bahkan pinjaman **1 hari** (pagi pinjam,
  sore kembali), dan **simpanan harian** yang bisa jadi agunan.
  ([KSP Makmur Mandiri](https://www.koperasimakmurmandiri.com/en/produk-kami/pinjaman-modal-usaha-mandiri.html))

### 1.2 Pesaing: rentenir / bank keliling
- Rentenir paling mudah ditemukan di pasar tradisional; bentuknya bank keliling, bank harian,
  pinjaman dengan bunga mingguan/bulanan. ([PNM](https://www.pnm.co.id/berita/rentenir:-ciri-ciri-cara-kerja-dan-solusi-pembiayaan-resmi))
- Mereka menang karena **cepat, tanpa agunan, kapan saja di mana saja** — bagi pedagang, memilih
  bank keliling bisa jadi pilihan rasional meski bunganya jauh lebih tinggi.
  ([Bank Keliling & Involusi Usaha Pedagang Pasar — USM](https://journals.usm.ac.id/index.php/solusi/article/view/1778),
  [Peran Bank Keliling — UIN Saizu](https://repository.uinsaizu.ac.id/24173/1/Syabina%20Garcinia_Peran%20Bank%20Keliling%20Dalam%20Menopang%20Usaha%20Pedagang%20Pasar%20Tradisional%20(Studi%20Kasus%20Bank%20Keliling%20Di%20Pasar%20Wage%20Purwokerto).pdf))
- **Implikasi produk:** yang harus dimenangkan KOPPAS adalah *kecepatan proses dan kemudahan
  bayar di lapak*, bukan hanya bunga lebih rendah. Software harus membuat kolektor cepat.

### 1.3 Risiko utama: kolektor
- Kasus nyata: kolektor KSP di Jawa Timur menggelapkan setoran angsuran ±Rp237 juta selama
  ±5 tahun dengan pola "gali lubang tutup lubang" (setor sebagian, sisanya menutup kekurangan
  sebelumnya). ([TIMES Indonesia](https://timesindonesia.co.id/hukum-kriminal/602552/gelapkan-setoran-nasabah-ratusan-juta-petugas-penagihan-diamankan-polres-bondowoso))
- Pola umum: pelaku memanfaatkan **celah buku kas harian dan sistem IT yang kurang terkawal**.
  ([Jurnal Warmadewa](https://www.ejournal.warmadewa.ac.id/index.php/juprehum/article/download/4941/3544))
- **Implikasi produk:** setiap uang yang diterima kolektor harus langsung tercatat atas nama
  kolektor, anggota bisa melihat bukti transaksinya sendiri (portal), dan setoran kolektor ke kas
  harus direkonsiliasi harian dengan selisih yang tercatat.

### 1.4 Lanskap software
- Aplikasi kolektor yang umum di pasar koperasi (Coopmax Collector, Sikopdit Collect, dll.):
  input setoran, penarikan, angsuran, ringkasan transaksi harian, sinkron ke core system, dengan
  tujuan transparansi dan mencegah penyelewengan. ([Coopmax Collector](https://coopmax.id/coopmax-collector/),
  [Sikopdit Collect V2](https://play.google.com/store/apps/details?id=com.sikopdit.collectV2&hl=id))
- **INKOPPAS** (induk, >2.000 koperasi pedagang pasar) meluncurkan **INKOPPAS Link** pada
  17 Sep 2026: transaksi, pembukuan, simpan pinjam, dan pembayaran QR dalam satu sistem; mitra
  Monologi (sistem) & Moneta (payment gateway); target awal 10 KOPPAS di Jakarta lalu Jateng,
  Kaltim, Kalsel, Sumbar. ([Warta Ekonomi](https://wartaekonomi.co.id/read635627/inkoppas-luncurkan-platform-digital-untuk-transaksi-dan-pembukuan-pedagang-pasar),
  [ANTARA](https://www.antaranews.com/berita/5748611/inkoppas-dorong-pedagang-pasar-beralih-ke-transaksi-digital),
  [INAnews](https://www.inanews.co.id/2026/09/launching-inkoppas-link-digitalisasi-pasar-pedagang-berdaya-pembeli-bahagia/))
  → Ini **pesaing langsung yang baru masuk** di segmen yang sama; diferensiasi SISKOP harus di
  kepatuhan akuntansi/regulasi (jurnal otomatis, laporan SAK EP, BMPP) dan alur kolektor yang
  aman.

### 1.5 Pengelolaan pasar (kios/los)
- Pedagang menempati kios/los dengan kewajiban **sewa** dan **retribusi pelayanan pasar harian**;
  tunggakan sewa/retribusi adalah masalah yang sering terjadi.
  ([Hukumonline](https://www.hukumonline.com/klinik/a/aturan-tentang-pemakaian-kios-di-pasar-tradisional-lt5993fa5295477/),
  [Jurnal Unram](https://eprints.unram.ac.id/35254/2/JURNAL%20ILMIAH%20NI%20KADEK%20PRAMITA%20KHARISMA%20DEWI.pdf))
- Hanya relevan untuk KOPPAS yang **mengelola pasar** (mis. [KOPPAS Tanah Abang](https://www.porosjakarta.com/bisnis/amp/067399161/koppas-tanah-abang-bidik-kebangkitan-pasar-lewat-pengelolaan-mandiri-dan-digitalisasi-inkoppas-dorong-revolusi-koperasi-modern?page=2)),
  bukan semua KOPPAS.

### 1.6 Regulasi (Permenkop UKM 8/2023)
- Bunga pinjaman maks **24%/tahun**, simpanan maks **9%/tahun**; BMPP pihak terkait 10% dan
  tidak terkait 15% dari Modal Sendiri; pinjaman > 90% dana himpunan → kelebihan ditempatkan di
  bank. ([DDTC](https://news.ddtc.co.id/berita/nasional/1802450/ini-batas-tertinggi-bunga-simpanan-dan-pinjaman-koperasi-simpan-pinjam),
  [DDTC](https://news.ddtc.co.id/berita/nasional/1802384/begini-aturan-penghimpunan-dan-penyaluran-dana-koperasi-simpan-pinjam))
- Semua angka ini **sudah** ada di `apps/backend/src/lib/regulatory-config.ts`.
- Catatan KOPPAS: produk harian di lapangan sering dipatok **flat per bulan/per hari**. Cap 24%
  di SISKOP membandingkan *rate nominal tahunan*; rate flat 2%/bulan lolos (=24%) walau suku
  bunga efektifnya lebih tinggi. Ini perlu keputusan kebijakan, bukan hanya teknis (lihat §4).

---

## 2. Gap Analysis

Legenda: ✅ ada · ⚠️ ada tapi tidak cocok untuk KOPPAS · ❌ belum ada.
Prioritas: **P0** = KOPPAS tidak bisa beroperasi benar tanpanya · P1 = penting untuk adopsi ·
P2 = diferensiasi/lanjutan.

### 2.1 Simpan pinjam

| # | Kebutuhan KOPPAS | Status | Kondisi di kode | Prio |
|---|---|---|---|---|
| L1 | Angsuran harian/mingguan | ❌ | `Loan` hanya punya `termMonths` + `monthlyPayment` (`schema.prisma`). Tidak ada frekuensi angsuran. | P0 |
| L2 | Jadwal angsuran per cicilan | ❌ | Tidak ada tabel jadwal. `recordLoanPayment` menerima `dueDate` dari input staf (`modules/loans/service.ts:305`). | P0 |
| L3 | KOL berbasis tunggakan harian | ⚠️ | `lib/kol.ts` menebak jatuh tempo per bulan (`setMonth(+i)`) dan mencocokkan tahun+bulan `payment.dueDate`. Angsuran harian yang bolong tidak terdeteksi. | P0 |
| L4 | Bunga harian (`RateType.HARIAN`) | ⚠️ | `lib/loan-calc.ts` menghitung bunga dari hari riil, tapi cicilan tetap dibagi `termMonths`. | P0 |
| L5 | Tenor dalam hari (mis. 30/60/100 hari) | ❌ | `maxTermMonths` di `LoanConfig`, `termMonths` di `Loan`. | P0 |
| L6 | Aritmetika uang `Decimal` di jalur pembayaran | ⚠️ | `recordLoanPayment` memakai `Number(...)` + `Math.max` untuk `remainingAmount`; schema `amount: z.coerce.number()`. Ratusan cicilan kecil per pinjaman memperbesar risiko selisih pembulatan. Melanggar aturan CLAUDE.md #2. | P0 |
| L7 | Pinjaman kilat 1 hari | ❌ | — | P2 |
| L8 | Denda keterlambatan otomatis | ⚠️ | `penalty` diinput manual per pembayaran. | P1 |
| L9 | Batas bunga & BMPP 10%/15% | ✅ | `lib/regulatory-config.ts`. | — |
| S1 | Simpanan pokok/wajib/sukarela + jurnal | ✅ | `Saving`, `SavingConfig`, `lib/journal.ts`. | — |
| S2 | Tabungan harian (setoran kecil tiap hari) | ✅/⚠️ | Deposit bisa berkali-kali, bunga harian ada (scheduler). Tidak ada target setoran harian/"wajib harian". | P1 |

### 2.2 Operasional kolektor

| # | Kebutuhan | Status | Kondisi | Prio |
|---|---|---|---|---|
| C1 | Peran Kolektor | ⚠️ | Custom role bisa dibuat (`/api/config/roles`), tapi permission hanya per modul (`savings.create`, `loans.update`) — tidak bisa dibatasi "hanya anggota binaan saya". | P0 |
| C2 | Penugasan kolektor ↔ anggota/blok | ❌ | Tidak ada relasi. | P0 |
| C3 | Daftar tagih hari ini | ❌ | Tidak ada endpoint/halaman. | P0 |
| C4 | Transaksi tercatat sebagai uang *di tangan kolektor* | ❌ | Transaksi langsung dijurnal ke Kas; `createdBy` ada tapi tidak ada konsep kas transit. | P0 |
| C5 | Setoran & rekonsiliasi harian kolektor (selisih tercatat) | ❌ | — | P0 |
| C6 | Rekap harian per kolektor (target vs realisasi) | ❌ | — | P1 |
| C7 | Bukti transaksi ke anggota (portal / WA) | ⚠️ | Portal anggota menampilkan riwayat simpanan & pinjaman; tidak ada notifikasi per transaksi. | P1 |
| C8 | Aplikasi kolektor (mobile) | ❌ | `apps/mobile` punya portal anggota + halaman staf umum, belum ada alur kolektor. | P0 |
| C9 | Offline-first + sinkronisasi | ❌ | — | P2 |
| C10 | GPS/foto bukti kunjungan | ❌ | — | P2 |

### 2.3 Data anggota & pasar

| # | Kebutuhan | Status | Kondisi | Prio |
|---|---|---|---|---|
| M1 | Profil pedagang: blok, nomor lapak, jenis dagangan, nama pasar | ❌ | `Member` hanya `occupation` + `address`. | P1 |
| M2 | Multi-pasar dalam satu koperasi | ❌ | Bisa diakali dengan `CooperativeUnit`, tapi unit = jenis usaha, bukan lokasi. Butuh atribut lokasi terpisah. | P2 |
| K1 | Master kios/los | ❌ | — | P2 |
| K2 | Kontrak sewa kios + piutang sewa | ❌ | Tipe unit `JASA` ada tapi tanpa modul backend. | P2 |
| K3 | Tagihan retribusi harian (kebersihan/keamanan) | ❌ | — | P2 |

### 2.4 Usaha lain & kanal pembayaran

| # | Kebutuhan | Status | Kondisi | Prio |
|---|---|---|---|---|
| U1 | Toko/grosir untuk anggota, kredit belanja, PPOB | ✅ | `modules/konsumen/*` (unit KONSUMEN). | — |
| U2 | KSU (simpan pinjam + toko + jasa) dalam satu tenant | ✅ | `CooperativeUnit`, laporan per unit & konsolidasi. | — |
| P1 | Bayar angsuran/tabungan via QRIS/VA | ❌ | Xendit hanya dipakai di onboarding/langganan (`modules/onboarding/xendit.ts`). | P2 |
| P2 | Integrasi ekosistem INKOPPAS Link | ❌ | — | P2 |

### 2.5 Yang sudah menjadi keunggulan

Jurnal otomatis dari setiap transaksi, laporan keuangan & CALK, SHU, batas regulasi (24%/9%/BMPP),
multi-unit dengan konsolidasi, portal anggota, dan audit log. Ini modal diferensiasi terhadap
aplikasi kolektor yang hanya mencatat transaksi.

---

## 3. MVP yang bisa dikejar sekarang

### 3.1 Prinsip
- **Bukan tipe koperasi baru.** KOPPAS tetap tenant KSP/KSU. Fitur diaktifkan lewat konfigurasi
  produk (frekuensi angsuran) dan keberadaan kolektor, bukan `if (type === 'PASAR')` — sejalan
  dengan aturan `KSU` di CLAUDE.md.
- **Tutup P0 saja.** Semua P0 ada di simpan pinjam + kolektor; itu yang membuat KOPPAS bisa
  benar-benar dipakai sehari-hari dan aman dari fraud kolektor.
- **Online dulu.** Pasar di kota umumnya punya sinyal; offline menambah kompleksitas
  sinkronisasi yang besar.

### 3.2 Ruang lingkup MVP

**A. Angsuran harian/mingguan + jadwal angsuran** (menutup L1–L6) — ukuran: L
- `LoanConfig`: `installmentFrequency` (`DAILY` | `WEEKLY` | `MONTHLY`, default `MONTHLY`) dan
  `maxTermInstallments`; opsi `skipSundays` (hari pasar libur) — lihat pertanyaan terbuka.
- `Loan`: `installmentFrequency`, `installmentCount`, `installmentAmount` (Decimal). `termMonths`/
  `monthlyPayment` dipertahankan untuk pinjaman bulanan lama (backward-compatible).
- Tabel baru `LoanInstallment` (`loanId`, `tenantId`, `seq`, `dueDate`, `principalDue`,
  `interestDue`, `paidAmount`, `status`), dibuat saat pencairan.
- `recordLoanPayment` mengalokasikan pembayaran ke cicilan tertua yang belum lunas (tidak lagi
  menerima `dueDate` dari klien); split pokok/bunga diambil dari jadwal, bukan rasio flat.
- `recalculateKOL` = hari tunggak dari cicilan tertua yang belum lunas. Ambang KOL tetap
  (≤30/90/120/180 hari) — perlu konfirmasi apakah KOPPAS memakai ambang yang sama untuk harian.
- Jalur pembayaran diubah ke `Prisma.Decimal` end-to-end.
- Migrasi: pinjaman aktif lama dibuatkan jadwal bulanan dari data yang ada.

**B. Kolektor & setoran kas** (menutup C1–C5) — ukuran: L
- Seed role **Kolektor**; relasi `CollectorAssignment` (`userId` ↔ `memberId`, tenant-scoped).
- Endpoint `GET /api/collections/today`: anggota binaan + cicilan jatuh tempo/tertunggak +
  target tabungan harian.
- Transaksi oleh kolektor (setoran simpanan, angsuran) dicatat dengan `collectorId` dan
  **dijurnal ke akun "Kas di Kolektor"** (akun transit baru di COA), bukan langsung ke Kas.
- `CollectionBatch` per kolektor per hari: `OPEN` → `SUBMITTED` (kolektor menyerahkan uang) →
  `VERIFIED` oleh teller (jurnal Kas ← Kas di Kolektor). Selisih kurang dicatat sebagai
  **piutang kolektor** + audit log; selisih lebih ke akun selisih kas. Kolektor tidak bisa
  mencatat transaksi di batch yang sudah `SUBMITTED`.
- Guard: kolektor hanya bisa bertransaksi untuk anggota binaannya; tidak bisa melakukan
  penarikan simpanan (MVP).

**C. Layar kolektor di `apps/mobile`** (menutup C8) — ukuran: M
- "Tagihan Hari Ini" (dikelompokkan per blok), input cepat angsuran/setoran, ringkasan batch,
  tombol "Serahkan Setoran". Online-only.

**D. Profil lapak pedagang** (menutup M1) — ukuran: S
- Kolom opsional di `Member`: `marketName`, `marketBlock`, `stallNumber`, `commodity`. Dipakai
  untuk mengurutkan rute tagih.

**E. Laporan** (menutup C6, sebagian L3) — ukuran: M
- Rekap harian per kolektor: target vs tertagih vs disetor vs selisih.
- Daftar tunggakan per kolektor/blok berbasis jadwal angsuran.

**Di luar MVP (fase berikutnya):** kios/sewa/retribusi (K1–K3), offline + sinkronisasi (C9),
QRIS/VA untuk angsuran (P1), notifikasi WA per transaksi (C7), GPS/foto (C10), pinjaman kilat
1 hari (L7), denda otomatis (L8), integrasi INKOPPAS Link (P2), multi-pasar (M2).

### 3.3 Urutan pengerjaan

1. **A** dulu — semua yang lain (daftar tagih, tunggakan, rekap) bergantung pada jadwal angsuran.
   Termasuk perbaikan Decimal (L6) karena menyentuh fungsi yang sama.
2. **D** (kecil, bisa paralel dengan A).
3. **B** backend + akun COA "Kas di Kolektor".
4. **C** mobile di atas endpoint B.
5. **E** laporan.

Setiap langkah mengikuti Definition of Done (TDD, coverage 80%, lint/typecheck bersih).
Test kunci: isolasi tenant pada `CollectorAssignment`/`CollectionBatch`; alokasi pembayaran ke
cicilan; KOL dari jadwal harian; jurnal batch seimbang (per unit + unallocated = konsolidasi);
kolektor tidak bisa menyentuh anggota non-binaan.

### 3.4 Kriteria sukses MVP
- Satu KOPPAS bisa menjalankan pinjaman 100 hari dengan angsuran harian, dan KOL-nya berubah
  benar ketika pedagang bolong bayar.
- Setiap rupiah yang diterima kolektor dapat ditelusuri: transaksi → batch → verifikasi teller →
  jurnal; selisih setoran langsung terlihat di hari yang sama.
- Anggota melihat angsuran & setorannya di portal pada hari yang sama.

---

## 4. Pertanyaan terbuka (butuh keputusan PM/Engineer)

1. **Hari libur pasar:** angsuran harian dihitung setiap hari kalender, hari kerja (tanpa
   Minggu), atau mengikuti hari pasaran? Mempengaruhi pembuatan jadwal.
2. **Ambang KOL untuk pinjaman harian:** tetap 30/90/120/180 hari, atau dipercepat (tenor 100
   hari tidak akan pernah mencapai MACET 180 hari)?
3. **Cap bunga untuk produk flat harian:** apakah validasi 24% cukup memakai rate nominal, atau
   perlu menghitung suku bunga efektif tahunan?
4. **Target pengguna pertama:** KOPPAS mana yang jadi pilot? Menentukan apakah modul kios/sewa
   (yang hanya relevan bagi koperasi pengelola pasar) perlu naik ke MVP.
5. **Posisi terhadap INKOPPAS Link:** bersaing, atau menjadi core/akuntansi yang terintegrasi?
