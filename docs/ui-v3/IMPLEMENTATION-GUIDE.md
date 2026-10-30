# SISKOP v3: Guideline Implementasi UI Baru

Dokumen ini melengkapi `design.md` dan `siskop-v3-mockup.html`. Isinya: persiapan, urutan kerja, gerbang verifikasi, risiko, dan **satu prompt master** (bagian 7) untuk dieksekusi sekali jalan oleh agen koding (Claude Code atau sejenisnya) di repo SISKOP.

---

## 1. Persiapan (5 menit, dilakukan manusia)

1. Buat cabang kerja: `git checkout -b feat/ui-v3`. Semua perubahan di cabang ini, tidak ke `main` langsung.
2. Salin tiga berkas ke repo:
   - `docs/ui-v3/design.md`
   - `docs/ui-v3/siskop-v3-mockup.html`
   - `docs/ui-v3/IMPLEMENTATION-GUIDE.md` (dokumen ini)
3. Pastikan baseline hijau sebelum mulai: `typecheck`, `lint`, `test`, `build` semua lolos. Catat hasilnya. Kalau sudah merah sebelum mulai, perbaiki atau catat dulu agar tidak tertukar dengan regresi.
4. Jalankan agen dari akar repo dengan izin edit berkas dan jalankan perintah proyek. Larang `git push`, `git reset --hard`, dan penghapusan di luar `apps/frontend`.

---

## 2. Prinsip eksekusi

- **Presentasi saja.** Tidak menyentuh API, envelope, logika bisnis, hook data, rute, atau skema zod.
- **Rute tetap.** Semua URL di `App.tsx` tetap berlaku.
- **Bertahap dan selalu bisa dijalankan.** Setiap fase berakhir dengan aplikasi yang build dan jalan. Satu commit per fase.
- **Stack tetap.** Tidak menambah pustaka UI baru. Pustaka kecil hanya jika benar-benar tak terhindarkan, dicatat alasannya.
- **Pakai ulang.** Utamakan komponen yang sudah ada di `components/ui/*` dan `components/shared/*`, ubah gayanya lewat token.
- **Mockup adalah acuan visual, bukan kode.** Jangan menyalin HTML atau JS mockup. Terjemahkan ke komponen React + Tailwind.

---

## 3. Fase dan gerbang verifikasi

Tiap fase hanya dianggap selesai bila gerbangnya lolos.

| Fase | Pekerjaan | Gerbang (harus lolos) |
|---|---|---|
| 0. Temuan | Baca berkas rujukan (brief §13), petakan komponen yang ada ke daftar komponen `design.md` §8, tulis rencana singkat di `docs/ui-v3/PROGRESS.md` | Rencana ada, daftar berkas yang akan diubah jelas |
| 1. Token | Ganti `:root` dan `.dark` di `index.css` dengan nilai `design.md` §2, tambah `brand`, `success`, `warning`, `info`, `hero-*`, `sidebar-*`, `chart-*`, perbarui `tailwind.config.js` (§12) | Build lolos, seluruh aplikasi berubah warna tanpa halaman rusak, tidak ada hijau tua tersisa |
| 2. Primitif | Sesuaikan Button, Input, Badge, Dialog, Toast. Buat `MoneyInput`, `KOLBadge`, `QuotaMeter`, `GlossaryTerm`, `LockedFeature`, `EmptyState`, `Stepper`, `PageHeader`, `StatCard` | Tiap komponen punya semua keadaan (default, hover, fokus, disabled, loading, error), tes unit untuk `MoneyInput` (pengelompokan ribuan, nilai murni) |
| 3. Shell | `AppLayout`, `Sidebar` (grup tugas, rail, drawer mobile, item terkunci), `Topbar` (pencarian, aksi cepat, lonceng, tema, pemilih unit bersyarat), `CommandPalette` | Navigasi per izin peran dan paket benar, pemilih unit hanya muncul jika unit usaha > 1, `Ctrl/⌘ K` berfungsi, fokus keyboard benar |
| 4. DataTable | Gaya baru: header lengket, kepadatan, filter chip, drawer baris, kartu di mobile | Header tidak menimpa data saat digulir, kolom uang rata kanan, bekerja di semua halaman pemakai |
| 5. Halaman P1 | Login, Beranda manajer, Anggota (list + drawer), Setor/tarik + struk, Pinjaman baru (stepper), POS mobile-first, Langganan, layar terkunci | Kriteria penerimaan (bagian 5) terpenuhi per halaman |
| 6. Halaman P2 dan P3 | Terapkan sistem ke sisanya (laporan, jurnal, Tutup Buku, hub Pengaturan, Kolektor, pendaftaran mandiri, portal anggota, Platform Admin) | Tidak ada halaman yang masih memakai gaya lama, keadaan kosong, memuat, galat, terkunci, hanya-baca ada |
| 7. Penutup | Audit aksesibilitas, audit sisa gaya lama, perbarui `PROGRESS.md` dan catatan migrasi | Semua gerbang bagian 4 lolos, laporan akhir dibuat |

Urutan fase wajib. Fase 1 dulu karena risikonya terendah dan langsung memberi hasil terlihat.

---

## 4. Verifikasi otomatis di setiap fase

Jalankan dan harus lolos sebelum commit: `typecheck`, `lint`, `test`, `build` (perintah sesuai `package.json`).

Pemeriksaan tambahan di fase akhir:
- Tidak ada `any` baru dan tidak ada gaya inline selain nilai dinamis.
- Cari sisa warna lama: `slate-`, `zinc-`, `bg-gray`, nilai hex hijau lama, dan sidebar `bg-slate`.
- Cari ikon-saja tanpa `aria-label`.
- Cari tombol dan tautan mati (tautan terkunci yang tidak menuju halaman terkunci).
- Jika Playwright atau Cypress sudah ada, tambah satu skenario "setor simpanan" (4 interaksi sampai struk).

---

## 5. Kriteria penerimaan (dari brief §4)

- Setor simpanan: pilih anggota, ketik nominal, Tinjau, Posting = **4 interaksi**, selesai di bawah 30 detik.
- Beranda: panel "Perlu perhatian hari ini" terlihat penuh di **1366x768 tanpa gulir**.
- Semua halaman terjangkau dengan **maksimal 2 klik atau satu pintasan** (`Ctrl/⌘ K`).
- Setiap layar punya keadaan **memuat, kosong, galat, terkunci, hanya-baca**.
- Berfungsi dari **360 px sampai 1920 px**, target sentuh mobile minimal **44 px**.
- **Terang dan gelap** berfungsi, `prefers-reduced-motion` dihormati.
- **WCAG 2.2 AA**: kontras sesuai tabel `design.md` §2.3, fokus terlihat, status tidak hanya warna.
- **White-label:** mengganti logo dan satu warna merek tidak merusak kontras, dan warna yang gagal kontras ditolak.
- Uang tampil `Rp 1.250.000`, tabular, rata kanan. Tanggal `dd MMM yyyy`, zona Asia/Jakarta.

---

## 6. Risiko dan pemulihan

| Risiko | Pencegahan |
|---|---|
| Shell menyentuh semua halaman | Fase 3 diuji dengan beberapa peran dan paket, jangan digabung dengan fase lain |
| DataTable bersama dipakai banyak halaman | Ubah di satu tempat lalu buka semua halaman pemakai sebelum commit |
| Pemilih unit salah muncul | Bergantung pada jumlah unit usaha tenant, bukan tipe KSU/KSP |
| Header tabel menimpa data | Pembungkus tabel `overflow: clip`, bukan `hidden` (lihat `design.md` §8.1) |
| Warna merek tenant merusak kontras | Validasi kontras saat simpan |
| Regresi fungsi | Commit per fase memudahkan `git revert` satu fase tanpa membuang yang lain |

Pemulihan: kembali ke commit fase sebelumnya. Jangan memperbaiki regresi dengan menimpa perilaku bisnis.

---

## 7. Prompt master (salin seluruh blok di bawah, tempel sekali)

```text
Kamu adalah engineer front-end senior sekaligus desainer produk. Tugasmu: mengimplementasikan redesign UI SISKOP v3 di repo ini, dari awal sampai selesai, dalam satu sesi, tanpa meminta konfirmasi di tengah jalan.

## Sumber acuan (baca dulu, lengkap)
1. docs/ui-v3/design.md  : aturan desain, token, komponen, pola, kriteria. WAJIB diikuti.
2. docs/ui-v3/siskop-v3-mockup.html : acuan visual. Buka dan pelajari tampilan, tata letak, dan interaksinya. Jangan menyalin HTML/JS-nya; terjemahkan ke React + Tailwind.
3. docs/ui-v3/IMPLEMENTATION-GUIDE.md : urutan fase, gerbang verifikasi, kriteria penerimaan, risiko.
4. Brief awal dan berkas repo: docs/01-PRD-SISKOP-v4.md, docs/package-modules/PRICING-V2-ROLLOUT.md, apps/frontend/src/App.tsx, components/layout/*, components/shared/*, components/ui/*, src/index.css, tailwind.config.js, pages/**, features/**.
Jika dua sumber bertentangan: tampilan ikut mockup, aturan ikut design.md, fakta bisnis dan izin/paket ikut PRD dan kode yang ada.

## Aturan keras (jangan dilanggar)
- Ini perubahan lapisan presentasi saja. JANGAN ubah API, envelope, hook data, logika bisnis, skema zod, atau rute. Semua URL di App.tsx tetap berlaku.
- Stack tetap: React 18, TypeScript strict, Vite, Tailwind 3.4, shadcn/ui di atas Radix, lucide-react, react-hook-form + zod, TanStack Query, Recharts, zustand, react-router v6. Jangan menambah kerangka UI baru. Pustaka tambahan hanya jika tak terhindarkan; catat alasannya di PROGRESS.md.
- Tema lewat CSS variable HSL dengan nama token shadcn, plus brand, success, warning, info, hero-*, sidebar-*, chart-* sesuai design.md §2. Tidak boleh ada warna hijau tua tersisa.
- Semua teks UI Bahasa Indonesia. Jangan ganti nama istilah domain (Simpanan, Pinjaman, Anggota, SHU, KOL, dst.).
- Jangan mengarang data, metrik, atau fitur yang tidak ada di aplikasi. Data contoh di mockup hanya untuk tampilan, jangan dimasukkan sebagai data nyata.
- Kode: TypeScript strict, tanpa any, komponen fungsional, ekspor bernama, hanya kelas Tailwind (inline style hanya untuk nilai dinamis), impor lewat alias @/, pakai cva dan cn().
- Hanya ubah berkas di apps/frontend dan docs/ui-v3. Jangan git push, jangan reset keras, jangan hapus di luar apps/frontend.
- Uang: "Rp 1.250.000", tabular-nums, rata kanan, negatif tidak hanya warna. Tanggal "dd MMM yyyy", zona Asia/Jakarta. Status tidak pernah hanya warna.
- Pemilih/filter unit usaha HANYA tampil bila tenant punya lebih dari satu unit usaha. Menu muncul sesuai izin peran; fitur terkunci paket memakai SATU pola LockedFeature (tidak pernah tautan mati).
- Header tabel lengket: pembungkus tabel memakai overflow: clip, bukan hidden; header top = tinggi topbar (60px), latar solid; kolom uang header ikut rata kanan.

## Cara kerja
Kerjakan fase berurutan sesuai IMPLEMENTATION-GUIDE.md §3 (Fase 0 sampai 7). Setiap fase:
1. Kerjakan perubahannya.
2. Jalankan typecheck, lint, test, build sesuai package.json. Harus lolos. Perbaiki sampai lolos; jangan lewati gerbang.
3. Jalankan gerbang khusus fase tersebut.
4. Commit satu kali dengan pesan jelas, format: "feat(ui-v3): fase N - <ringkasan>". Jangan push.
5. Perbarui docs/ui-v3/PROGRESS.md: fase selesai, berkas diubah, keputusan, asumsi, sisa pekerjaan.
Mulai dengan Fase 0: baca berkas rujukan, petakan komponen yang ada ke daftar komponen design.md §8, tulis rencana di PROGRESS.md, lalu lanjut tanpa menunggu persetujuan.

Cakupan fase:
- 1 Token: index.css (:root dan .dark) dan tailwind.config.js sesuai design.md §2 dan §12.
- 2 Primitif: Button, Input, Badge, Dialog, Toast; buat MoneyInput (pengelompokan ribuan langsung, simpan angka murni), KOLBadge, QuotaMeter, GlossaryTerm, LockedFeature, EmptyState, Stepper, PageHeader, StatCard. Semua keadaan: default, hover, fokus, disabled, loading, error. Tambah tes unit untuk MoneyInput.
- 3 Shell: AppLayout, Sidebar (grup Harian, Anggota, Keuangan, Laporan, Pengaturan; rail; drawer mobile; item terkunci), Topbar (pencarian, aksi cepat per peran, lonceng, tema, pemilih unit bersyarat), CommandPalette (Ctrl/Cmd+K: aksi cepat, halaman, cari anggota via nama/nomor/NIK). Pertahankan semua rute dan izin yang ada.
- 4 DataTable: header lengket, kepadatan nyaman/padat, filter chip, baris membuka drawer, kartu di mobile, ekspor.
- 5 Halaman prioritas 1: Login (staf pilih koperasi, anggota via NIK), Beranda manajer ("Perlu perhatian hari ini" dari data nyata yang tersedia di API; jika suatu sumber data tidak ada, jangan ditampilkan dan catat di PROGRESS.md), Anggota (list + drawer detail), Setor/tarik (pilih anggota, nominal, tinjau, posting, struk dengan cetak/bagikan/transaksi berikutnya), Pinjaman baru (stepper 4 langkah, jadwal memakai perhitungan yang SUDAH ADA di aplikasi, bukan rumus mockup), POS mobile-first, Langganan (kuota, tagihan, fitur terkunci), halaman terkunci.
- 6 Halaman prioritas 2 dan 3: terapkan sistem yang sama ke laporan, Rekening Koran dan cetak, Jurnal Manual dan Tutup Buku (konfirmasi dua langkah/ketik untuk konfirmasi, konsekuensi dalam bahasa biasa), hub Pengaturan (ganti 13 tab dengan layout navigasi samping, tanpa mengubah isi form), Kolektor pasar mobile, pendaftaran mandiri anggota dan antrean tinjau, portal anggota mobile, Platform Admin.
- 7 Penutup: audit aksesibilitas (kontras token, fokus, aria-label ikon, aria pada dialog/tabel/toast/meter, urutan fokus shell, tautan "Lewati ke konten"), audit sisa gaya lama (slate-, zinc-, bg-gray, hijau lama, sidebar bg-slate), pastikan tiap layar punya keadaan memuat/kosong/galat/terkunci/hanya-baca, white-label (ganti logo + satu warna merek menimpa --brand dan --ring; tolak warna yang kontras teks putihnya < 4,5:1).

## Kriteria penerimaan (harus terpenuhi di akhir)
- Setor simpanan: pilih anggota, ketik nominal, Tinjau, Posting = 4 interaksi, di bawah 30 detik.
- Panel "Perlu perhatian hari ini" terlihat penuh di 1366x768 tanpa gulir.
- Tiap halaman terjangkau maksimal 2 klik atau satu pintasan (Ctrl/Cmd+K).
- Berfungsi 360 sampai 1920 px; target sentuh mobile >= 44 px.
- Terang dan gelap berfungsi; prefers-reduced-motion dihormati.
- WCAG 2.2 AA; kontras sesuai design.md §2.3.
- typecheck, lint, test, build lolos di commit terakhir.

## Jika terhalang
Jangan berhenti untuk bertanya. Ambil keputusan paling masuk akal dan paling aman, catat sebagai asumsi di PROGRESS.md, lalu lanjut. Berhenti HANYA bila langkah berikutnya tak bisa dibatalkan atau berisiko merusak data/pengguna; dalam kasus itu selesaikan pekerjaan persiapan, jelaskan keputusan yang dibutuhkan, dan berhenti.
Jika sebuah gerbang gagal dan tidak bisa diperbaiki wajar dalam fase itu: revert perubahan fase itu saja, catat penyebabnya, lanjut ke fase berikutnya yang tidak bergantung padanya.

## Laporan akhir (jawaban terakhirmu)
Tulis ringkas: (1) fase yang selesai dan commit-nya, (2) berkas utama yang berubah, (3) hasil typecheck/lint/test/build, (4) kriteria penerimaan: terpenuhi atau tidak beserta buktinya, (5) asumsi dan pertanyaan terbuka, (6) risiko yang masih ada dan cara memverifikasinya secara manual. Jangan mengklaim sesuatu lolos tanpa benar-benar menjalankannya.
```

---

## 8. Setelah prompt selesai (dilakukan manusia)

1. Baca `docs/ui-v3/PROGRESS.md` dan laporan akhir agen.
2. Jalankan aplikasi, buka halaman prioritas 1 di 1366x768 dan 390 px, terang dan gelap.
3. Uji alur setor simpanan sampai struk dengan keyboard saja.
4. Uji dengan dua peran dan dua paket berbeda (menu dan item terkunci).
5. Uji tenant dengan satu unit dan dengan dua unit (pemilih unit).
6. Review diff per commit fase, lalu buka PR dari `feat/ui-v3`.
