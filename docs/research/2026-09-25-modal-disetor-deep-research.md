# Deep Research: Fitur "Modal Disetor" — Best Practice & Relasi dengan Laporan dan Dashboard

> Tanggal: 2026-09-25 · Konteks: SISKOP v3 (`feature/savings-group-by-member`) · Depth: thorough

## Executive Summary

Regulasi koperasi simpan pinjam Indonesia yang berlaku **tidak memakai istilah "modal disetor"**.
Permenkop UKM 8/2023 memakai **Modal Sendiri** (simpanan pokok + simpanan wajib + dana cadangan +
hibah + simpanan lain berkarakter wajib) sebagai dasar BMPP, rasio konsentrasi, dan klasifikasi
skala KSP; **Modal Usaha Awal** untuk syarat pendirian; dan **Modal Tetap** untuk USP (unit simpan
pinjam dalam koperasi serba usaha). Permenkop UKM 2/2024 Pasal 12 memakai kata "modal" tanpa
definisi untuk ambang audit Rp5 miliar — interpretasi paling konsisten adalah Modal Sendiri per
akhir tahun buku (untuk USP: Modal Tetap USP).

SISKOP saat ini menyimpan `Tenant.modalDisetor` sebagai **angka yang diinput manual** di halaman
Config, lalu memakainya untuk (a) notifikasi ambang audit Rp5 miliar dan (b) batas pinjaman
pengurus/pengawas 10%. Padahal semua komponen Modal Sendiri sudah tercatat di buku besar (akun
EKUITAS di COA). Best practice: **angka ini diturunkan (derived) dari saldo akun ekuitas per
tanggal**, bukan input bebas — sehingga neraca, laporan perubahan ekuitas, dashboard, BMPP, dan
ambang audit memakai satu sumber kebenaran yang sama.

Gap terbesar di luar istilah: SISKOP **belum punya Laporan Perubahan Ekuitas** (wajib per
Permenkop 2/2024 & SAK EP), COA menggabungkan "Cadangan / Modal Penyertaan" padahal keduanya
berbeda status hukum, BMPP 15% untuk pihak tidak terkait belum ada, dan dashboard belum
menampilkan indikator permodalan sama sekali.

## Key Findings

1. **"Modal disetor" bukan istilah regulasi KSP.** Permenkop 8/2023 Pasal 1 mendefinisikan
   Modal Sendiri, Modal Tetap, Modal Usaha Awal, Modal Penyertaan — tidak ada "modal disetor"
   ([Permenkop 8/2023, BPK](https://peraturan.bpk.go.id/Download/317418/permenkop-kukm-no-8-tahun-2023.pdf)).
   "Modal disetor" adalah istilah PT (UU 40/2007), terbawa ke SISKOP dari kebiasaan umum.
2. **Modal Sendiri = pokok + wajib + dana cadangan (dari SHU) + hibah + simpanan berkarakter
   wajib** (+ modal tetap induk untuk KSP hasil pemisahan) — Pasal 1 angka 23 Permenkop 8/2023,
   selaras UU 25/1992 Pasal 41 ([UU 25/1992](https://peraturan.bpk.go.id/Download/35388/UU%20Nomor%2025%20Tahun%201992.pdf)).
   **Modal Penyertaan tidak termasuk** Modal Sendiri.
3. **BMPP pihak terkait (pengurus, pengawas, koperasi afiliasi) ≤10% Modal Sendiri; pihak tidak
   terkait ≤15% Modal Sendiri** — Pasal 44–45. Untuk USP, basisnya **Modal Tetap USP** (Pasal 1
   angka 18). SISKOP baru menerapkan 10% dan pakai `modalDisetor` manual.
4. **Ambang audit AP:** "Laporan Keuangan tahunan KSP/USP … yang mempunyai modal paling sedikit
   Rp5.000.000.000,00 dalam 1 tahun buku, wajib diaudit oleh Akuntan Publik" — Pasal 12(1)
   Permenkop 2/2024 ([BPK](https://peraturan.bpk.go.id/Details/308465/permenkop-ukm-no-2-tahun-2024);
   [DDTC](https://news.ddtc.co.id/berita/nasional/1802166/koperasi-simpan-pinjam-modal-rp5-miliar-lapkeu-wajib-diaudit-ap)).
   Frasa "dalam 1 tahun buku" → dievaluasi per tahun buku, bukan real-time harian.
5. **Penyajian ekuitas (Permenkop 2/2024 Lampiran, Bagian IV Akuntansi Ekuitas):** simpanan
   pokok & wajib disajikan di ekuitas; modal tetap & tambahan (USP) di ekuitas; SHU & dana
   cadangan di ekuitas; "ekuitas lain" pos tersendiri. Contoh neraca: *Simpanan pokok/modal tetap
   · Simpanan wajib/modal tambahan · Cadangan umum · Cadangan risiko · Sisa hasil usaha · Ekuitas
   lain*. Simpanan sukarela/berjangka = **liabilitas**.
6. **Laporan Perubahan Ekuitas wajib**, kolom: Simpanan pokok/modal tetap · Simpanan wajib/modal
   tambahan · SHU · Cadangan umum · Cadangan risiko · Ekuitas lain; baris: saldo awal, penambahan
   modal, pengurangan modal, pembagian SHU, SHU periode berjalan, saldo akhir. Laporan Arus Kas
   menaruh penambahan/pengurangan pokok & wajib di **aktivitas pendanaan**.
7. **Pelaporan periodik:** tahunan (30 April primer / 30 Juni sekunder), triwulanan (20 Apr/Jul/Okt),
   semesteran (20 Juli), via sistem elektronik Kementerian (Pasal 10–11 Permenkop 2/2024). SAK EP
   & audit AP berlaku paling lambat tahun buku 2025 (Pasal 13–14).
8. **Rasio struktur modal:** Modal Pinjaman bank/obligasi ≤40% aset (Pasal 65), Modal Penyertaan
   ≤25% aset (Pasal 68), pokok+wajib+penyertaan satu anggota ≤20% Modal Sendiri (Pasal 63(6)),
   Modal Sendiri **tidak boleh berkurang dari jumlah semula** (Pasal 63(5)).
9. **Klasifikasi usaha KSP I–IV** berbasis anggota, Modal Sendiri (≤2,5M / 2,5–15M / 15–50M /
   >50M) dan/atau aset (Pasal 49; ringkasan [Prolegal](https://prolegal.id/baru-berikut-ketentuan-izin-usaha-koperasi-simpan-pinjam-ksp-2023/)).
10. **Kesehatan KSP (Perdep 06/Per/Dep.6/IV/2016):** aspek permodalan = Modal Sendiri/Total Aset,
    Modal Sendiri/Pinjaman Berisiko, Modal Sendiri/ATMR (CAR)
    ([contoh perhitungan](https://repository.unpkediri.ac.id/1498/4/RAMA_6121_16102020010_0706108902_0721088505_07_lamp.pdf)).
    Benchmark internasional WOCCU PEARLS: *net institutional capital / total assets ≥10%*
    ([WOCCU PEARLS](https://www.woccu.org/documents/pearls_monograph)).

## Detailed Analysis

### A. Kondisi SISKOP saat ini

| Area | Implementasi | Lokasi |
|---|---|---|
| Penyimpanan | `Tenant.modalDisetor Decimal(15,2)?`, diisi manual | `apps/backend/prisma/schema.prisma:236`, `ModalDisetorConfigTab.tsx` |
| Ambang audit | Notifikasi harian bila `modalDisetor ≥ 5M`, sekali per tahun WIB | `apps/backend/src/modules/config/audit-threshold.ts` |
| BMPP pihak terkait | 10% × `modalDisetor` (null → 0 → semua pinjaman pengurus ditolak) | `apps/backend/src/lib/regulatory-config.ts`, `loans/service.ts:119` |
| COA ekuitas | 3-1000 Pokok, 3-1100 Wajib, 3-2000 **"Cadangan / Modal Penyertaan"**, 3-3000 SHU berjalan, 3-3100 SHU lalu | `apps/backend/src/lib/coaTemplate.ts:39-43` |
| Neraca | Section EKUITAS dari saldo GL + SHU berjalan terhitung; per-unit via `unitId` | `reports/regulatory-service.ts:162` |
| Perubahan Ekuitas | **Tidak ada** | — |
| Dashboard | totalSavings (pokok+wajib+sukarela digabung), pinjaman aktif, anggota, angsuran bulan ini, macet | `dashboard/service.ts:5` |

### B. Masalah konseptual input manual

- **Dua sumber kebenaran.** Neraca menyajikan pokok+wajib+cadangan dari GL; `modalDisetor` angka
  terpisah yang bisa basi. Setelah setoran wajib bulanan, angka BMPP tidak ikut naik; setelah
  anggota keluar (pokok/wajib dikembalikan), angka tidak turun → BMPP terlalu longgar.
- **Tidak ada as-of date & audit trail.** Pasal 12 menilai per tahun buku; field tunggal tanpa
  riwayat tidak bisa menjawab "berapa modal per 31 Des 2025?" saat auditor/dinas bertanya.
- **Null → 0 memblokir.** Tenant baru yang belum isi field tidak bisa memberi pinjaman ke
  pengurus sama sekali, walau GL-nya sudah punya ekuitas.

### C. Model yang direkomendasikan

```
ModalSendiri(asOf, unitId?) =
    saldo 3-1000 Simpanan Pokok
  + saldo 3-1100 Simpanan Wajib
  + saldo Dana Cadangan (cadangan umum + cadangan risiko)
  + saldo Hibah
  (+ Modal Tetap/Tambahan untuk USP per unit)
  − TIDAK termasuk Modal Penyertaan, SHU berjalan belum dibagi
```

1. **Pecah COA:** `3-2000 Cadangan` → `3-2000 Cadangan Umum`, `3-2100 Cadangan Risiko`,
   `3-4000 Hibah`, `3-5000 Modal Penyertaan` (atau "Ekuitas Lain"); tambah flag akun
   `isModalSendiri` supaya komposisi bisa dikonfigurasi, bukan hard-code kode akun.
2. **Service tunggal** `getModalSendiri(tenantId, asOf, unitId?)` di reports, dipakai oleh neraca,
   perubahan ekuitas, BMPP, ambang audit, dashboard. Money tetap `Decimal`.
3. **Field manual jadi opsional "override/opening balance"** hanya untuk tenant migrasi yang
   belum punya saldo awal di GL — dengan tanggal efektif, alasan, dan user pencatat; tampilkan
   selisih vs angka GL.
4. **Ambang audit** dievaluasi terhadap Modal Sendiri per **tutup tahun buku** (plus peringatan
   dini bila proyeksi berjalan ≥ 5M), bukan hanya nilai field saat ini.
5. **BMPP:** 10% pihak terkait (sudah), tambah **15% per peminjam pihak tidak terkait**; pada
   multi-unit (KSU), basis untuk unit simpan pinjam = **Modal Tetap unit tsb**, konsisten dengan
   aturan 2b (per-unit filter).
6. **Rename UI/types:** "Modal Disetor" → "Modal Sendiri" (label regulasi), pertahankan alias di
   copy bila pengguna terbiasa.

### D. Relasi dengan laporan

| Laporan | Relasi Modal Sendiri | Aksi SISKOP |
|---|---|---|
| Neraca / Laporan Posisi Keuangan | Pos ekuitas = komponen modal sendiri + SHU + ekuitas lain | Susun ulang label sesuai Lampiran Permenkop 2/2024; subtotal "Modal Sendiri" |
| **Laporan Perubahan Ekuitas** | Rekonsiliasi saldo awal→akhir tiap komponen | **Bangun baru** (gap wajib) |
| Arus Kas | Setoran/penarikan pokok & wajib = pendanaan; pembagian SHU = pendanaan | Sudah memetakan counter EKUITAS → PENDANAAN (`regulatory-service.ts:297`); validasi |
| Perhitungan Hasil Usaha / SHU | Alokasi SHU → dana cadangan menambah Modal Sendiri; jasa modal dibagi proporsional pokok+wajib | Jurnal penutupan tahun: SHU → cadangan otomatis sesuai AD/ART |
| CALK | Rincian komposisi modal, kebijakan akuntansi ekuitas, status audit | Tambah section permodalan |
| Laporan RAT | Pertumbuhan modal sendiri YoY, rasio permodalan | Tambah ringkasan |
| Pelaporan ke Kemenkop (triwulan/semester/tahunan) | Semua laporan di atas per periode | Kalender tenggat + reminder (pola scheduler yang sama dgn audit threshold) |

### E. Relasi dengan dashboard

KPI permodalan yang layak tampil (per-unit & konsolidasi, sesuai rule 2b):

- **Modal Sendiri** (angka + tren 12 bulan) dengan breakdown pokok/wajib/cadangan/hibah.
- **Rasio Modal Sendiri / Total Aset** — indikator kesehatan Perdep 06/2016 (PEARLS ≥10% sebagai
  benchmark).
- **Rasio Modal Sendiri / Pinjaman Berisiko** dan **CAR (Modal / ATMR)**.
- **Pemakaian BMPP:** total pinjaman pihak terkait vs 10%, peminjam terbesar vs 15%.
- **Konsentrasi modal anggota:** anggota dengan pokok+wajib > 20% modal sendiri.
- **Progress ke ambang audit Rp5M** + klasifikasi KSP I–IV saat ini.
- **Pisahkan "Total Simpanan"** menjadi Ekuitas (pokok+wajib) vs Liabilitas (sukarela/berjangka);
  saat ini `totalSavings` menggabungkan keduanya, menyesatkan bila dibaca sebagai dana pihak ketiga.
- Countdown tenggat laporan periodik ke Kementerian.

## Contrarian Views And Risks

- **"Modal" di Pasal 12 bisa ditafsir lain** (mis. total ekuitas termasuk SHU, atau modal +
  penyertaan). Regulasi tidak mendefinisikan; sumber sekunder (DDTC) juga tidak. Mitigasi: jadikan
  komposisi konfigurable dan tampilkan beberapa ukuran; konfirmasi ke Deputi/dinas atau KAP.
- **Derivasi GL bergantung kualitas jurnal.** Tenant yang migrasi tanpa saldo awal lengkap akan
  melihat Modal Sendiri terlalu kecil → BMPP menolak pinjaman sah. Itu alasan override manual
  tetap perlu (dengan audit trail), bukan dihapus total.
- **Koperasi sektor riil / konsumen:** Pasal 12(2) — kriteria audit ditetapkan Deputi, bukan
  Rp5M. Ambang Rp5M jangan diterapkan membabi buta ke tenant non-simpan-pinjam.
- **RUU Perkoperasian** (perubahan UU 25/1992) masih dibahas per April 2026 dan membahas ulang
  definisi modal pokok/wajib & kemungkinan sertifikat modal koperasi
  ([Open Parliament](https://openparliament.id/2026/04/02/ruu-perkoperasian/);
  [Kompas](https://money.kompas.com/read/2025/11/21/164021926/kemenkop-harap-ruu-perkoperasian-disahkan-sebelum-maret-2026)).
  Desain komposisi berbasis flag akun lebih tahan perubahan daripada hard-code.
- **Retur pokok/wajib saat anggota keluar** menurunkan Modal Sendiri, bisa bentrok dengan Pasal
  63(5) "tidak boleh berkurang". Sistem sebaiknya **memperingatkan**, bukan memblokir (keputusan
  pengurus/RAT).
- **Perdep 06/2016** tabel skor/bobot lengkap tidak berhasil diverifikasi dari sumber primer di
  riset ini; angka ambang skor jangan di-hard-code sebelum dicek ke dokumen resmi.

## Open Questions

1. Apakah Kemenkop sudah menerbitkan penjelasan resmi definisi "modal" Pasal 12 Permenkop 2/2024?
2. Untuk KSU multi-unit: apakah ambang audit dinilai dari Modal Tetap USP saja atau Modal Sendiri
   koperasi induk?
3. Apakah Perdep 06/2016 masih berlaku setelah Permenkop 8/2023, atau sudah ada pedoman kesehatan
   baru?
4. Bagaimana perlakuan simpanan wajib yang di AD/ART boleh ditarik sebagian (hybrid) — ekuitas
   atau liabilitas menurut SAK EP?
5. Format file/API sistem pelaporan elektronik Kementerian (Pasal 10) — bisa diintegrasi otomatis?

## Rekomendasi Prioritas (untuk PM/Engineer)

| P | Item | Alasan |
|---|---|---|
| P0 | Laporan Perubahan Ekuitas | Wajib Permenkop 2/2024, belum ada |
| P0 | `getModalSendiri` derived dari GL; BMPP & audit pakai ini | Hilangkan dua sumber kebenaran |
| P1 | Pecah COA cadangan/penyertaan/hibah + flag `isModalSendiri` | Modal Penyertaan ≠ Modal Sendiri |
| P1 | BMPP 15% pihak tidak terkait; basis Modal Tetap per unit USP | Pasal 45 & definisi BMPP |
| P1 | Dashboard KPI permodalan + split simpanan ekuitas vs liabilitas | Visibilitas pengurus |
| P2 | Rename "Modal Disetor" → "Modal Sendiri", override manual ber-audit-trail | Kesesuaian istilah |
| P2 | Kalender tenggat pelaporan periodik | Pasal 11 |

## Sources

- [Permenkop UKM 8/2023 (PDF, BPK)](https://peraturan.bpk.go.id/Download/317418/permenkop-kukm-no-8-tahun-2023.pdf) — primer; definisi Modal Sendiri, BMPP, permodalan (dibaca teks penuh).
- [Permenkop UKM 8/2023 (peraturan.go.id)](https://peraturan.go.id/id/permenkop-kukm-no-8-tahun-2023) — metadata.
- [Permenkop UKM 2/2024 (JDIH BPK)](https://peraturan.bpk.go.id/Details/308465/permenkop-ukm-no-2-tahun-2024) — primer; Pasal 10–14 & lampiran akuntansi ekuitas (dibaca teks penuh).
- [Materi Permenkop 2/2024 (IAI)](https://web.iaiglobal.or.id/assets/files/file_publikasi/Materi_Permenkop%202%20thn%202024_Kemenkop%20dan%20UKM.pdf) — slide sosialisasi Kemenkop.
- [UU 25/1992 (BPK)](https://peraturan.bpk.go.id/Download/35388/UU%20Nomor%2025%20Tahun%201992.pdf) — Pasal 41 komponen modal.
- [DDTC: KSP modal Rp5M wajib audit](https://news.ddtc.co.id/berita/nasional/1802166/koperasi-simpan-pinjam-modal-rp5-miliar-lapkeu-wajib-diaudit-ap) — ringkasan Pasal 12.
- [DDTC: Kebijakan akuntansi KSP SAK EP](https://news.ddtc.co.id/berita/nasional/1802464/begini-kebijakan-akuntansi-koperasi-simpan-pinjam-berdasarkan-sak-ep) — ringkasan akuntansi ekuitas.
- [DDTC: SAK ETAP diganti SAK EP](https://news.ddtc.co.id/berita/nasional/1801610/sak-etap-diganti-sak-ep-kebijakan-baru-akuntansi-koperasi-dirilis) — konteks transisi.
- [Prolegal: izin KSP 2023](https://prolegal.id/baru-berikut-ketentuan-izin-usaha-koperasi-simpan-pinjam-ksp-2023/) — ringkasan modal usaha awal & klasifikasi.
- [Permenkop 11/2018 (BPK)](https://peraturan.bpk.go.id/Details/160787/permenkop-ukm-no-11-tahun-2018) — regulasi lama yang dicabut.
- [Lampiran perhitungan kesehatan KSP (UNP Kediri)](https://repository.unpkediri.ac.id/1498/4/RAMA_6121_16102020010_0706108902_0721088505_07_lamp.pdf) — rumus rasio permodalan Perdep 06/2016 (sekunder, akademik).
- [Jurnal UM: tingkat kesehatan KSP](https://journal2.um.ac.id/index.php/ekobis/article/download/2350/1414) — konteks rasio CAR/ATMR.
- [WOCCU PEARLS monograph](https://www.woccu.org/documents/pearls_monograph) — benchmark kapital institusional.
- [WOCCU Model Regulations Matrix](https://www.woccu.org/documents/ModelRegulationsMatrix) — 10% institutional capital.
- [Open Parliament: RUU Perkoperasian](https://openparliament.id/2026/04/02/ruu-perkoperasian/) — status legislasi 2026.
- [Kompas: target pengesahan RUU](https://money.kompas.com/read/2025/11/21/164021926/kemenkop-harap-ruu-perkoperasian-disahkan-sebelum-maret-2026) — konteks.
- [UPT KUKM Jatim: pengelolaan modal sendiri](https://uptdiklatukm.diskopukm.jatimprov.go.id/2021/11/15/strategi-pengelolaan-modal-sendiri-ekuitas-pada-koperasi/) — praktik.

Catatan metode: Firecrawl CLI tidak tersedia di mesin ini; pengumpulan memakai web search + fetch,
PDF regulasi diekstrak dengan `pdftotext`. Kode SISKOP dibaca langsung dari repo.

## Rerun Inputs

```
workflow: firecrawl-deep-research
topic: modal disetor / modal sendiri koperasi — regulasi, akuntansi SAK EP, relasi laporan & dashboard SISKOP
depth: thorough
output: markdown (docs/research/)
```
