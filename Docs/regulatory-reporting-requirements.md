# Regulatory Reporting Requirements — Koperasi (Indonesia)

| | |
|---|---|
| **Scope** | Koperasi Simpan Pinjam (KSP) & Koperasi Simpan Pinjam Pembiayaan Syariah (KSPPS), Indonesia |
| **Panel research date** | 21 Juli 2026 |
| **Terkait** | `Docs/01-PRD-SISKOP.md` §6.6/§8, `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md` §10a |
| **Disclaimer** | This is a product-planning reference, not legal advice. Deadlines, thresholds, and draft-bill provisions below should be verified against the primary regulation text (JDIH Kemenkop UKM, OJK, DPR RI) before being relied on for compliance decisions or hard-coded into the product. |

---

## 1. Who This Applies To

Two layers of obligation exist, and most koperasi only ever hit the first:

1. **Baseline obligations** — apply to every koperasi, including a plain closed-loop KSP/KSPPS that only takes deposits from and lends to its own members (SISKOP's current tenant model, per `01-PRD-SISKOP.md`).
2. **Conditional obligations** — only apply if a koperasi's activity crosses into "Koperasi Sektor Jasa Keuangan" (KSJK) territory (§2.5) — e.g. it starts accepting funds from non-members. SISKOP tenants aren't modeled that way today, but this is worth a periodic check as the product grows.

---

## 2. Currently Mandatory

### 2.1 Annual Financial Statements

**Legal basis:** Permenkop UKM No. 2/2024 (Kebijakan Akuntansi Koperasi), in force since diundangkan 16 Januari 2024, applicable from tahun buku 2025 onward — already in effect as of today. Requires use of SAK issued by IAI (SAK EP for KSP/KSPPS, unless already using full SAK Indonesia).

| # | Laporan | Isi Singkat | Status di SISKOP |
|---|---|---|---|
| 1 | **Neraca** | Posisi aset, kewajiban, ekuitas pada tanggal tertentu | Belum ada — Phase 3 roadmap (lihat `konfigurasi-akun-coa-design.md` §10) |
| 2 | **Laporan Perhitungan Hasil Usaha** | Pengganti istilah "laba rugi" — merinci hasil usaha dengan anggota vs. bukan anggota, menghasilkan SHU | Sebagian — RPT-01 agregat pendapatan, bukan SHU resmi |
| 3 | **Laporan Arus Kas** | Arus kas masuk/keluar per aktivitas operasi, investasi, pendanaan | Belum ada |
| 4 | **Laporan Promosi Ekonomi Anggota (LPEA)** | Manfaat ekonomi anggota: (a) pengadaan barang/jasa bersama, (b) pemasaran/pengolahan bersama, (c) simpan pinjam lewat koperasi, (d) pembagian SHU | Belum ada — laporan terhitung, tidak bisa diturunkan otomatis dari saldo akun; butuh spek kalkulasi terpisah |
| 5 | **Catatan Atas Laporan Keuangan (CALK)** | Kebijakan akuntansi + penjelasan pos-pos neraca/hasil usaha | Belum ada — kemungkinan tetap sebagian naratif/manual walau ledger sudah ada |

> **Catatan verifikasi:** beberapa panduan berbasis SAK ETAP (bukan SAK EP) turut mencantumkan **Laporan Perubahan Ekuitas** sebagai laporan ke-6. Materi sosialisasi resmi IAI untuk Permenkop 2/2024 hanya menyebut 5 laporan di atas. Konfirmasikan ke teks Permenkop 2/2024 / SAK EP langsung sebelum menganggap Laporan Perubahan Ekuitas sebagai kewajiban terpisah untuk KSP/KSPPS.

**Format & administrasi wajib:**
- Bahasa Indonesia, denominasi Rupiah
- Ditandatangani oleh pengurus koperasi
- Disampaikan melalui sistem pelaporan elektronik (manual hanya dalam kondisi tertentu)

**Tenggat waktu:**

| Jenis Laporan | Tenggat |
|---|---|
| Laporan keuangan tahunan — koperasi primer | 30 April tahun berikutnya |
| Laporan keuangan tahunan — koperasi sekunder | 30 Juni tahun berikutnya |
| Laporan keuangan triwulanan I | 20 April tahun berjalan |
| Laporan keuangan triwulanan II | 20 Juli tahun berjalan |
| Laporan keuangan triwulanan III | 20 Oktober tahun berjalan |
| Laporan keuangan semesteran | 20 Juni tahun berjalan |
| Laporan sewaktu-waktu | Saat diperlukan (permintaan regulator) |

> **Belum terverifikasi ke sumber primer:** urutan tenggat semesteran (20 Juni) muncul lebih awal dari triwulanan II (20 Juli) pada sumber sekunder yang ditemukan — ini janggal secara logis dan kemungkinan kesalahan penyusunan ulang oleh sumber, bukan isi asli regulasi. **Jangan hard-code tenggat ini ke dalam fitur reminder tanpa verifikasi ke teks Permenkop 2/2024 Pasal terkait.**

### 2.2 Audit Wajib oleh Akuntan Publik (kondisional)

**Legal basis:** Permenkop UKM No. 2/2024 Pasal 12.

- **Trigger:** modal koperasi ≥ **Rp 5 miliar** dalam satu tahun buku
- **Berlaku untuk:** KSP/USP dan KSPPS/USPPS (kriteria audit koperasi sektor riil ditetapkan terpisah oleh deputi terkait)
- **Sejak:** tahun buku 2025 — **sudah berjalan**, siklus pertama (laporan tahun buku 2025, tenggat 30 April/30 Juni 2026) sudah lewat per tanggal riset ini
- **Ketentuan tambahan:** akuntan publik & KAP wajib terdaftar di Kemenkop UKM dan Kemenkeu; rotasi KAP sama maksimal 3 tahun berturut-turut, jeda 2 tahun sebelum bisa dipakai lagi

**Relevansi produk:** ini adalah sinyal prioritas — tenant dengan modal mendekati/melewati Rp5 miliar butuh Neraca+CALK yang auditable lebih cepat dari tenant lain. Lihat rekomendasi Backend di `konfigurasi-akun-coa-design.md` §10a soal menambahkan field modal/aset tenant untuk notifikasi proaktif.

### 2.3 Dokumen Governance Wajib RAT (Non-Laporan-Keuangan)

**Legal basis:** UU No. 25/1992 tentang Perkoperasian Pasal 26, 35–36; diperkuat praktik kelengkapan isian RAT Kemenkop UKM.

| Dokumen | Isi | Dasar Hukum |
|---|---|---|
| **Laporan Pertanggungjawaban Pengurus** | Perhitungan tahunan (neraca + hasil usaha + penjelasan) dan keadaan/perkembangan koperasi; ditandatangani seluruh pengurus | UU 25/1992 §35–36 |
| **Laporan Pengawas** | Verifikasi pembukuan, kesesuaian kebijakan pengurus dengan AD/ART, rekomendasi strategis | UU 25/1992 §39; praktik RAT |
| **Daftar Pembagian SHU per Anggota** | Rincian SHU yang diterima tiap anggota | Turunan Laporan Hasil Usaha; praktik RAT |
| **Rancangan Rencana Kerja & RAPBK tahun berikutnya** | Rencana kerja dan anggaran pendapatan/belanja koperasi tahun depan | UU 25/1992 (agenda rapat anggota); praktik RAT |

**Tenggat:** RAT wajib diadakan minimal sekali setahun (UU 25/1992 §26); praktik umum daerah mensyaratkan RAT paling lambat **6 bulan setelah tutup buku**.

**Relevansi produk:** dokumen-dokumen ini tidak berasal dari ledger transaksi — direkomendasikan panel jadi modul terpisah ("Modul RAT/Governance"), bukan bagian dari modul akuntansi. Lihat `konfigurasi-akun-coa-design.md` §10a butir Product.

### 2.4 Sanksi Ketidakpatuhan (Permenkop 2/2024)

Bertingkat (progresif):

1. Teguran tertulis
2. Penangguhan penerbitan sertifikat Nomor Induk Koperasi (NIK)
3. Penurunan penilaian kesehatan koperasi
4. Pembekuan sementara izin usaha simpan pinjam
5. Pencabutan izin usaha simpan pinjam
6. Penutupan dan pembubaran koperasi

### 2.5 Pelaporan OJK — Koperasi Sektor Jasa Keuangan (KSJK), kondisional

**Legal basis:** POJK No. 47/2024 tentang Koperasi di Sektor Jasa Keuangan — diundangkan 31 Desember 2024, **sudah berlaku** untuk koperasi yang memenuhi kriteria KSJK.

**Trigger (salah satu dari):**
- Menghimpun dana dari pihak selain anggota koperasi yang bersangkutan
- Menghimpun dana dari anggota koperasi lain
- Menyalurkan pinjaman ke pihak selain anggota koperasi yang bersangkutan, dan/atau ke anggota koperasi lain
- Menerima sumber pendanaan dari bank/lembaga keuangan lain melewati batas maksimal yang ditetapkan
- Melakukan layanan jasa keuangan di luar usaha simpan pinjam

**Konsekuensi jika terpicu:** koperasi berpotensi wajib mendaftar sebagai Lembaga Jasa Keuangan (LJK) di bawah OJK, dengan kewajiban pengumuman dan pelaporan tambahan gaya-OJK — di luar jalur Kemenkop yang dipakai koperasi simpan-pinjam biasa.

**Relevansi produk:** model tenant SISKOP saat ini (per PRD/FSD) diasumsikan closed-loop — simpan pinjam murni antar anggota sendiri. Ini belum relevan untuk arsitektur saat ini, tapi layak jadi item pemantauan: jika ada tenant yang model bisnisnya bergeser ke salah satu kriteria di atas, mereka berpotensi kena kewajiban pelaporan OJK yang sama sekali di luar cakupan sistem hari ini.

---

## 3. Upcoming / Proposed — Belum Berlaku

### 3.1 RUU Perkoperasian (Revisi UU No. 25/1992)

**Status per 21 Juli 2026:** masih dalam pembahasan DPR. Pemerintah menyampaikan Daftar Inventarisasi Masalah (DIM) dalam rapat kerja bersama Komisi VI DPR pertengahan Juni 2026. **Belum disahkan** — provisi di bawah bisa berubah sebelum jadi undang-undang, dan belum ada tanggal berlaku yang pasti.

**Perubahan yang diusulkan dan relevan untuk pelaporan:**

1. **Pemisahan closed loop vs. open loop** — koperasi closed loop (layanan internal anggota saja) tetap di bawah pembinaan Kemenkop; koperasi open loop (menghimpun dana dari luar anggota) sepenuhnya di bawah pengawasan OJK. Ini pada dasarnya memformalkan dan memperluas apa yang sudah dimulai POJK 47/2024 (§2.5) menjadi pembagian berbasis undang-undang, bukan sekadar kriteria teknis.
2. **Badan pengawasan khusus simpan pinjam** di bawah Kemenkop — otoritas pengawas baru untuk koperasi closed loop.
3. **Lembaga Penjamin Simpanan Koperasi (LPS Koperasi)** — usulan lembaga penjamin simpanan anggota, mirip LPS perbankan. Jika terealisasi, kemungkinan menambah kewajiban pelaporan/premi berkala ke lembaga ini — pola serupa laporan bank ke LPS saat ini.
4. **Digitalisasi tata kelola keuangan internal** — salah satu dari lima pilar strategis RUU ini; berpotensi relevan langsung untuk produk seperti SISKOP sebagai penyedia sistem digital koperasi.
5. **Sanksi pidana lebih berat** untuk penyimpangan pengurus.

**Catatan penting:** ini masih rancangan undang-undang (RUU), bukan aturan yang berlaku. Perlakukan sebagai arah kebijakan (directional), bukan sesuatu yang actionable, sampai disahkan dan aturan turunannya (PP/Permenkop/POJK) terbit.

### 3.2 Konteks Historis (referensi)

- **2023:** Menteri Koperasi (saat itu) Teten Masduki sempat mengusulkan pemindahan pengawasan KSP ke OJK, disebut sebagai langkah "pemurnian" identitas koperasi.
- **RUU P2SK** (disahkan sebelum RUU Perkoperasian ini): pada akhirnya **tidak** memindahkan pengawasan KSP ke OJK — tetap di Kemenkop. Namun ini membuka jalan bagi POJK 47/2024 mengatur koperasi yang secara fungsi menjalankan aktivitas jasa keuangan (KSJK) di luar simpan pinjam murni antar-anggota.

---

## 4. Ringkasan — Status Kepatuhan & Kesiapan SISKOP

| Kewajiban | Status Hukum | Status SISKOP |
|---|---|---|
| 5 Laporan Keuangan Tahunan (Neraca, PHU, Arus Kas, LPEA, CALK) | Wajib sekarang | Belum ada — Phase 3 roadmap |
| Laporan Keuangan Periodik (triwulanan/semesteran) | Wajib sekarang | Belum ada |
| Audit Akuntan Publik (modal ≥ Rp5 miliar) | Wajib sekarang (kondisional) | N/A — output eksternal; sistem hanya perlu menyediakan data auditable |
| Laporan Pertanggungjawaban Pengurus & Laporan Pengawas | Wajib sekarang | Di luar cakupan modul akuntansi — potensi modul RAT terpisah |
| Daftar Pembagian SHU per Anggota | Wajib sekarang | Belum ada — butuh konfigurasi formula distribusi SHU |
| Rencana Kerja & RAPBK | Wajib sekarang | Di luar cakupan modul akuntansi |
| Pelaporan OJK (jika KSJK) | Wajib sekarang, kondisional | Tidak relevan untuk model tenant closed-loop saat ini — pantau saja |
| Restrukturisasi closed loop/open loop, LPS Koperasi, badan pengawas baru | **Belum berlaku** — RUU dalam pembahasan | Tidak actionable — pantau progres legislasi |

---

## 5. Rekomendasi Tindak Lanjut

- **Verifikasi tenggat pelaporan periodik** (§2.1) langsung ke teks Permenkop UKM No. 2/2024 sebelum membangun fitur reminder/notifikasi tenggat — ada indikasi inkonsistensi kecil di sumber sekunder yang ditemukan.
- **Pantau progres RUU Perkoperasian** sepanjang 2026 — revisi dokumen ini saat RUU disahkan atau DIM berkembang signifikan.
- **Tambahkan field modal/aset tenant** (lihat `konfigurasi-akun-coa-design.md` §10a, rekomendasi Backend) sebagai sinyal prioritas untuk tenant yang mendekati ambang audit Rp5 miliar.
- **Tidak perlu membangun apa pun untuk KSJK/OJK saat ini** — tidak ada tenant SISKOP yang cocok dengan kriteria itu berdasarkan model produk saat ini; cukup jadi item pemantauan berkala kalau arah produk berubah (mis. fitur pendanaan antar-koperasi).

---

## Sumber

- [UU No. 25 Tahun 1992 tentang Perkoperasian](https://investasi-perizinan.ntbprov.go.id/admin_baru/gambar/1.UU%20No.25%20Thn%201992%20ttng%20Perkoperasian.pdf)
- [Permenkop UKM No. 2 Tahun 2024 — BPK](https://peraturan.bpk.go.id/Details/308465/permenkop-ukm-no-2-tahun-2024)
- [Siaran Pers IAI — Permenkop No. 2/2024](https://web.iaiglobal.or.id/Berita-IAI/detail/siaran_pers_iai_-_permenkop_no22024_sak_yang_disusun_iai_wajib_digunakan_untuk_menyusun_laporan_keuangan_koperasi_di_seluruh_indonesia)
- [Kelengkapan Isian RAT — Kemenkop UKM](https://www.inovasidiskumtangerangkab.com/assets/files/download/Kelengkapan%20Isian%20RAT%20dari%20Bidang%20Kelembagaan%20Kementerian%20Koperasi%20dan%20UKM%20RI.pdf)
- [Permenkop 2/2024 — kewajiban audit akuntan publik](https://hidayatullah.cpa.or.id/permen-kopukm-no-2-tahun-2024-tentang-kebijakan-akuntansi-koperasi-mewajibkan-koperasi-di-audit-akuntan-publik)
- [Laporan Keuangan Koperasi: Jenis, Standar, dan Contohnya — Kledo](https://kledo.com/blog/laporan-keuangan-koperasi/)
- [POJK No. 47 Tahun 2024 — Koperasi di Sektor Jasa Keuangan — OJK](https://ojk.go.id/id/regulasi/Pages/POJK-47-Tahun-2024-Koperasi-di-Sektor-Jasa-Keuangan.aspx)
- [Koperasi Bisa Jadi LJK? Ini Ketentuannya dalam POJK 47/2024 — Prolegal](https://prolegal.id/koperasi-bisa-jadi-ljk-ini-ketentuannya-dalam-pojk-47-2024/)
- [Menakar Hulu-Hilir Krisis dan Ambisi RUU Perkoperasian — Kompas](https://money.kompas.com/read/2026/06/20/140500526/menakar-hulu-hilir-krisis-dan-ambisi-ruu-perkoperasian)
- [RUU Perkoperasian — Open Parliament](https://openparliament.id/2026/04/02/ruu-perkoperasian/)
- [Pengawasan Koperasi Simpan Pinjam Pindah ke OJK — Bisnis.com (2023 context)](https://finansial.bisnis.com/read/20230201/89/1623692/pengawasan-koperasi-simpan-pinjam-pindah-ke-ojk-menteri-teten-pemurnian)
- [RUU P2SK Disetujui, Koperasi Simpan Pinjam Tak Jadi Beralih Pengawasan ke OJK — Kontan](https://keuangan.kontan.co.id/news/ruu-p2sk-disetujui-koperasi-simpan-pinjam-tak-jadi-beralih-pengawasan-ke-ojk)
