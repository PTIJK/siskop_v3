# UI v3: PROGRESS

Branch: `enhance/new-design-ui` (from `origin/main` bb6a993). Presentation layer only; no API, hook, route, or zod changes.

## Baseline (before any change)

`apps/frontend`: `tsc --noEmit` exit 0, `eslint src` exit 0, `vitest run` 14 files / 132 tests pass.

Gate commands (run in `apps/frontend`): `npx tsc --noEmit`, `npx eslint src`, `npx vitest run`, `npx vite build`.

## Fase 0: Temuan dan rencana

### Pemetaan komponen yang ada ke design.md §8

| design.md §8 | Sekarang | Rencana |
|---|---|---|
| Button | `ui/button.tsx` (default/destructive/outline/secondary/ghost/link; h-10) | Tambah varian `brand`, `loading`; ukuran sm 32 / default 38 / lg 48; pertahankan nama varian lama (dipakai ratusan tempat) dan petakan `default` ke primary tinta |
| Input | `ui/input.tsx` (h-10, ada toggle sandi) | h-[42px], radius 10, `aria-invalid` -> garis destructive |
| MoneyInput | belum ada | BARU `ui/money-input.tsx` + `lib/money-input.ts` (fungsi murni + tes) |
| MemberPicker | tersebar per halaman (NewSavingPage, NewLoanPage) | BARU `shared/MemberPicker.tsx` memakai endpoint yang sama dengan halaman |
| Badge | `ui/badge.tsx` (pil, 4 varian) | Tambah varian status ok/warn/bad/info dengan penanda bentuk |
| KOLBadge | `shared/KOLBadge.tsx` (hijau/kuning/oranye/merah) | Tulis ulang: "KOL n Nama", token, penanda bentuk. Prop `category` tetap |
| Card / StatCard | `ui/card.tsx`, `shared/StatCard.tsx` (pulse, shadow) | Garis 1px tanpa bayangan; StatCard: label, nilai, delta ikon+teks; prop lama tetap kompatibel |
| DataTable | `shared/DataTable.tsx` (257 baris, pemakai banyak halaman) | Fase 4: header lengket, `overflow: clip`, kepadatan, chip, kartu mobile; API prop tetap |
| Drawer | belum ada (Dialog saja) | BARU `ui/drawer.tsx` di atas Radix Dialog |
| Dialog | `ui/dialog.tsx` | Radius 20, maks 480, z-index skala |
| Toast | `ui/toast.tsx`, `ui/toaster.tsx` | Kanan bawah, `role=status`, hilang 3 dtk, token |
| Banner | `layout/AccessBanner.tsx` | Gaya token, dapat ditutup |
| EmptyState | inline di DataTable | BARU `shared/EmptyState.tsx` |
| LockedFeature | `NotEntitledNotice`, `EntitlementNotice` (dua pola) | BARU `shared/LockedFeature.tsx`; dua notice lama menjadi pembungkus tipis |
| QuotaMeter | `QuotaBadge`, `ui/progress.tsx` | BARU `shared/QuotaMeter.tsx` (`role=meter`); QuotaBadge dipertahankan untuk tombol buat |
| GlossaryTerm | belum ada | BARU `shared/GlossaryTerm.tsx` |
| Stepper | belum ada | BARU `shared/Stepper.tsx` |
| PageHeader | `shared/PageHeader.tsx` | Judul 26px/800, breadcrumb, deskripsi; prop tetap |
| CommandPalette | belum ada | BARU `layout/CommandPalette.tsx` |
| Sidebar/Topbar | `layout/Sidebar.tsx` (pohon dengan akordeon, `bg-slate-900`), `layout/Topbar.tsx` | Fase 3: grup tugas, rail, drawer, item terkunci via `useEntitlements().isLocked`; pemilih unit via `useIsMultiUnit` |

### Rute dan izin yang WAJIB dipertahankan (dari Sidebar.tsx / App.tsx)

Dashboard, Anggota, Piutang Anggota (`konsumen:read`, fitur `member_receivables`), Beban Umum (`expenses:read`), Simpanan (`savings:read`), Pinjaman + Menunggak (`loans:read`), Toko (`konsumen:read`, `unit_konsumen`), Pasar (`market:read`, `unit_pasar`), Laporan (`reports:read`, 7 anak dengan fitur masing-masing), Laporan Konsolidasi (`reports:read`, multi-unit), Konfigurasi (`config|roles|accounting:read`), Langganan, Platform Admin (5 rute, hanya `super_admin`, menu tenant disembunyikan).

### Fakta yang mempengaruhi desain

- Sidebar sekarang memuat item yang tidak ada di tabel design.md §7.1 (Piutang Anggota, Beban Umum, Laporan Konsolidasi, Pinjaman Menunggak, Kualitas Portofolio, Laporan Pasar). Keputusan: grup design.md tetap, item ekstra ditempatkan di grup terdekat agar tidak ada rute yang hilang dari navigasi (lihat Fase 3).
- Kunci paket: `isLocked(feature)` mengarah ke `/langganan?fitur=<key>` hari ini. Pola LockedFeature baru harus menjadi tujuan itu.
- `AppLayout.test.tsx` mengunci kontrak: shell tetap tampil saat modul halaman lazy masih tertunda, teks "Memuat halaman" dan `role="status"`.
- Sisa gaya lama (hitungan baris, awal): `slate-` 36, `green-` 21, `amber-` 15, `red-NNN` 23, `bg-gray` 1, inline `style={{` 15.
- Tailwind sekarang memetakan token `sidebar-background`/`sidebar-primary`/dst. gaya shadcn; design.md §12 memakai `sidebar`, `sidebar-foreground`, `sidebar-active`. Token lama dipertahankan sebagai alias sampai tidak ada pemakai.

### Asumsi

1. Uji visual penuh di peramban tidak dijalankan otomatis; verifikasi memakai tsc/eslint/vitest/vite build, ditambah pemeriksaan manual yang dicantumkan di laporan akhir.
2. Nama varian Button/Badge lama dipertahankan agar halaman yang belum disentuh tetap valid.

## Status fase

| Fase | Status | Commit |
|---|---|---|
| 0 Temuan | selesai | lihat git log |
| 1 Token | selesai | lihat git log |
| 2 Primitif | selesai | lihat git log |
| 3 Shell | selesai | lihat git log |
| 4 DataTable | selesai | lihat git log |
| 5 Halaman P1 | selesai | lihat git log |
| 6 Halaman P2/P3 | selesai | lihat git log |
| 7 Penutup | selesai | lihat git log |

## Fase 1: Token (selesai)

Berkas: `apps/frontend/src/index.css`, `apps/frontend/tailwind.config.js`.

- `:root` dan `.dark` diganti sesuai design.md §2.1/§2.2. Token shadcn lama yang masih dipakai (`popover`, `secondary`, `destructive-foreground`) dipertahankan dengan nilai selaras. Token baru: `brand`, `brand-foreground`, `success`, `warning`, `info`, `hero-*`, `sidebar`/`sidebar-foreground`/`sidebar-active`, `chart-1..5`.
- Token `sidebar-background/primary/accent/border/ring` gaya shadcn dihapus; tidak ada pemakai (dicek dengan grep).
- Tailwind: warna baru, `fontFamily.sans` Manrope, radius (lg 14 / md 10 / sm 8), skala z-index bernama (sidebar 30 ... toast 70).
- Manrope 400-800 diimpor global di `index.css` (sebelumnya hanya di MarketingShell).
- `prefers-reduced-motion` dihormati global; aturan cetak `.print-area` bersifat opt-in lewat `body:has(.print-area)` agar Ctrl+P di halaman lain tidak kosong.
- Keputusan: `--chart-3..5` ditambahkan (design.md hanya mendefinisikan 1-2) untuk sebaran KOL 5 segmen; nilainya dari token status.
- Keputusan: situs pemasaran/onboarding (`features/onboarding/styles.css`, kelas `.marketing`) memakai palet hijau hutan sendiri dan BUKAN bagian tema aplikasi. Di luar cakupan "hijau tua" aplikasi; dicatat untuk Fase 7 (diaudit, tidak diubah tanpa mockup acuan).
- Radius global berubah (sebelumnya 8px): komponen lama otomatis lebih bulat.

Gerbang: tsc 0, eslint 0, vitest 132/132, vite build sukses.

## Fase 2: Primitif (selesai)

Diubah: `ui/button` (varian brand, ukuran 32/38/48, prop `loading` + `aria-busy`), `ui/input` (42px, `aria-invalid`), `ui/badge` (varian ok/warn/bad/info + penanda bentuk, accent), `ui/dialog` (radius 20, maks 480, scrim/modal z, tombol tutup "Tutup"), `ui/card` (tanpa bayangan, radius 16, padding 18), `ui/toast` + `toaster` (kanan bawah, 3 dtk; galat 6 dtk, tombol tutup bernama), `shared/KOLBadge` ("KOL n Nama" + penanda), `shared/PageHeader` (26/800, breadcrumb ber-ol, aria-current), `shared/StatCard` (tanpa pulse/bayangan, klik = tombol sungguhan), `shared/EntitlementNotice` dan `NotEntitledNotice` (kini pembungkus LockedFeature inline), `shared/QuotaBadge` (token).

Baru: `ui/money-input` + `lib/money-input`, `ui/drawer`, `shared/QuotaMeter`, `GlossaryTerm`, `LockedFeature`, `EmptyState`, `Stepper`. MemberPicker ditunda ke Fase 5 karena bergantung pada endpoint pencarian anggota di halaman Setor/Pinjaman.

Tes: `lib/money-input.test.ts` (9) dan `components/primitives.test.tsx` (14). Total 155 tes lulus.

Keputusan:
- MoneyInput menyimpan string digit ("1250000"), bukan float; konsisten dengan aturan uang bukan Float. Ada `digitsToNumber` hanya untuk perbandingan tampilan.
- Toast galat tampil 6 dtk (bukan 3) karena pesan galat perlu dibaca; selain itu 3 dtk sesuai design.md.
- QuotaMeter memakai ambang 85% (design.md §8); `lib/entitlements` tetap 80% untuk logika "near" yang sudah ada dan teruji (tidak diubah: bukan lapisan presentasi). Dua ambang ini berbeda tipis; dicatat.
- Nama varian lama Button/Badge dipertahankan (`default` = primary tinta).

Gerbang: tsc 0, eslint 0, vitest 155/155, vite build sukses.

## Fase 3: Shell (selesai)

Baru: `layout/nav.ts` (model menu tunggal dipakai Sidebar dan palet: grup, izin, kunci paket, aksi cepat per peran, pencocokan), `layout/CommandPalette.tsx` (Radix Dialog + pola combobox/listbox, tanpa pustaka baru), `layout/BrandMark.tsx`, `lib/theme.ts` (terang/gelap, disimpan, diterapkan sebelum render pertama di `main.tsx`), `stores/unit-scope.ts`.
Ditulis ulang: `layout/AppLayout.tsx` (gulir dokumen agar header tabel lengket top 60px; tautan "Lewati ke konten"; Ctrl/Cmd+K; rail tersimpan), `layout/Sidebar.tsx` (grup Harian/Anggota/Keuangan/Laporan/Pengaturan; rail 72px; drawer <= 900px dengan scrim dan Esc; item terkunci = ikon gembok + tautan ke `/langganan?fitur=<key>`; kartu paket + QuotaMeter di kaki), `layout/Topbar.tsx` (pencarian pemicu palet, aksi cepat split-button per peran, lonceng, tema, menu pengguna, pemilih unit bersyarat, Ganti Koperasi dipertahankan).
Disentuh: `NotificationBell`, `AccessBanner` (token, label aksesibel), `AppLayout.test.tsx` (mock CommandPalette), dashboard + Kualitas Portofolio + 7 tab laporan (nilai awal filter unit dari `unit-scope`).

Keputusan:
- Item menu dipetakan ke grup design.md; item yang tidak ada di tabel §7.1 (Piutang anggota, Beban umum, Menunggak, Kualitas portofolio, Laporan pasar, Konsolidasi, Jurnal manual, Tutup buku) ditempatkan di grup terdekat; tidak ada rute lama yang hilang dari navigasi (dijaga oleh tes `nav.test.ts`).
- Izin per item sama dengan Sidebar lama (mis. Jurnal manual/Tutup buku memakai `reports:read`). "Setor dan tarik" memakai `savings:create`; "Simpanan" (daftar) tetap `savings:read`.
- Pemilih unit memakai `useAccessibleUnits` (unit yang boleh dibuka pemanggil), konsisten dengan `UnitFilter` yang sudah ada: tampil hanya bila > 1. Dashboard dan Kualitas Portofolio memakai nilai global; tab laporan memakai nilai itu hanya sebagai nilai awal (filter laporan tetap tersimpan per sesi).
- Nama koperasi tidak tersedia di data klien (`User` dan `TenantSubscriptionInfo` tidak memuatnya), jadi kartu kaki sidebar menampilkan paket dan kuota saja, tidak mengarang nama.
- Item terkunci tidak pernah ditandai halaman aktif; kontrak lama ke `/langganan?fitur=` dipertahankan, dan SubscriptionPage akan menampilkan LockedFeature untuk parameter itu di Fase 5.
- Judul h1 dipindah dari Topbar ke PageHeader tiap halaman (menghindari dua h1).
- Tema: `.dark` diterapkan di `<html>` untuk seluruh SPA, termasuk halaman pemasaran/onboarding (yang memakai warna heks sendiri; hanya satu aturan `hsl(var(--input))` terpengaruh). Dicatat sebagai risiko Fase 7.

Tes baru: `nav.test.ts` (13), `format-nik.test.ts` (2). Total 171 lulus.
Gerbang: tsc 0, eslint 0, vitest 171/171, vite build sukses.
Belum diverifikasi di peramban nyata (lihat laporan akhir): Ctrl/Cmd+K, urutan fokus, drawer mobile.

## Fase 4: DataTable (selesai)

Diubah: `shared/DataTable.tsx` (prop lama tidak berubah; tambahan opsional: `chips`, `exportOptions`, `emptyDescription`, `emptyAction`, `label`), `ui/table.tsx` (TableHead 44px/12,5px/bold).

- Header lengket `top-[60px]`, latar solid `bg-muted`; pembungkus kartu `overflow-clip`; wrapper gulir bawaan `Table` dinetralkan (`overflow-visible`) karena jika tidak ia menjadi container gulir dan sticky gagal.
- Kolom uang: kelas `text-right` pada ColumnDef mengenai header dan sel, dan otomatis memberi `tabular-nums`.
- Kepadatan Nyaman/Padat (disimpan di localStorage), filter chip dengan jumlah, baris interaktif bisa difokus dan Enter/Spasi membuka drawer/halaman, ekspor lewat menu footer (halaman memasok aksi nyatanya), paginasi dengan jendela 5 halaman yang mengikuti halaman aktif (sebelumnya halaman > 5 tak terjangkau kecuali lewat tombol berikutnya).
- <= 900px: header disembunyikan, tiap baris jadi kartu dua kolom dengan label dari `data-label`.
- Keadaan memuat (skeleton), kosong (EmptyState), galat (pesan manusiawi + Coba lagi), semua di dalam tabel.

Keputusan/risiko: tabel lebar di 901-1100px tidak lagi punya gulir horizontal sendiri (wrapper netral agar sticky bekerja; kartu clip). Jika ada halaman dengan kolom sangat banyak, periksa manual.

Pemeriksaan peramban nyata (Puppeteer + mock /api, Vite 3200, tanpa backend/DB):
- Anggota 1366x768 terang/gelap/rail: menu per izin benar, item terkunci bergembok dan bernama "terkunci", halaman aktif ber-aria-current, h1 tunggal, Manrope aktif.
- Header tabel: position sticky, top 60px, wrapper overflow clip, scroller visible.
- Ctrl+K membuka palet dengan fokus di input; cari anggota "siti" menemukan hasil dengan NIK tersamar; Esc menutup.
- Teller: tidak ada Pinjaman/Laporan/Pengaturan, aksi cepat "Setor simpanan"; satu unit: tanpa pemilih unit; dua unit: pemilih tampil.
- 390px: tombol menu, tanpa gulir horizontal, tabel jadi kartu, drawer menu dengan tautan >= 44px, Esc menutup.

Gerbang: tsc 0, eslint 0, vitest 171/171, vite build sukses.

## Fase 5: Halaman prioritas 1 (selesai)

**Beranda** (`pages/dashboard/`): `AttentionPanel` + `attention.ts` ("Perlu perhatian hari ini"), `TrendChart` (garis, label di ujung, padat vs putus-putus, tabel pengganti, ringkasan untuk pembaca layar), `KolDistribution` (lima segmen berangka + legenda tertulis), KPI memakai `formatRupiahRingkas` (nilai penuh di tooltip dan teks sr-only), warna grafik dari token. Pemilih unit halaman dihapus karena kini di Topbar.
Sumber data panel (semua nyata, tidak ada yang dikarang): `/dashboard/summary` (pinjaman macet), `/dashboard/loan-quality` (KOL 2-4 + NPL), `/members/registration-requests?status=PENDING` (jumlah pendaftaran menunggu), `/dashboard/pasar` (batch belum diverifikasi, hanya bila fitur ada), `/config/subscription` (faktur terbuka), `/dashboard/capital` (rasio modal < 10%, konsentrasi simpanan). Tugas muncul hanya bila angkanya > 0 dan peran berizin; diurutkan risiko (mendesak, perlu ditinjau, info). Tidak tersedia di API sehingga TIDAK ditampilkan: "jurnal belum diposting" dan "Transaksi terakhir" (tidak ada endpoint).
**Anggota**: `MemberDrawer` (klik baris membuka drawer: simpanan per jenis, pinjaman + KOL, Setor/Tarik/Pinjaman baru sesuai izin, "Halaman lengkap"); tombol Detail/Edit tetap. Filter chip Aktif/Nonaktif TIDAK dipasang: `GET /members?isActive=` memakai `z.coerce.boolean()` sehingga "false" terbaca true. Itu bug backend, di luar cakupan presentasi; dicatat untuk tim.
**Setor dan tarik** (`pages/savings/`): /savings/new kini memuat dua pekerjaan: Setor dan tarik (default) dan Buka rekening (`?mode=buka`, form lama yang digayakan ulang; tautan lama di SavingsPage dan MemberDetailPage diarahkan ke `?mode=buka`). Alur: `MemberPicker` (cari lewat `/savings/by-member`) -> kolom nominal otomatis fokus -> Tinjau -> dialog tinjau -> Posting -> `SavingReceipt` (nomor, tanggal "29 Okt 2026, 21:35 WIB", anggota, jenis, saldo setelah dari server, petugas, Cetak/Bagikan/Transaksi berikutnya). Rekening default: sukarela untuk setor; rekening berisi saldo bukan pokok untuk tarik. Logika murni dites (`saving-flow.test.ts`).
**Pinjaman baru**: stepper 4 langkah (Anggota, Produk dan syarat, Jadwal, Tinjau) di atas logika yang sama: jadwal memakai `lib/loan-calc` untuk bulanan dan endpoint `preview-schedule` untuk harian/mingguan, nominal memakai MoneyInput, Ajukan aktif setelah centang pemeriksaan, footer lengket. Markup langkah 1 dipertahankan agar 12 tes lama lulus.
**POS**: tile 96px, di <= 1180px bilah bawah (jumlah barang, total, tombol Bayar 56px) membuka lembar bawah berisi keranjang dan metode bayar (Tunai/Transfer/Kredit Anggota: metode nyata, bukan "Non-tunai" generik); kolom keranjang lengket di desktop.
**Langganan**: kartu paket + Badge status, `QuotaMeter`, daftar fitur dengan "Tersedia di paket X", keadaan memuat/galat/kosong, dan LockedFeature halaman penuh bila dibuka lewat `?fitur=<key>` (inilah tujuan item terkunci di sidebar dan tugas panel). Riwayat tagihan tidak ditampilkan: API hanya mengembalikan faktur terbuka.
**Login**: `AuthLayout` baru (dua kolom, panel dua lingkaran bertaut, tautan lewati ke konten) dipakai AuthPage (/login) dan LoginPage (/login/legacy); logika Firebase/pemilihan koperasi/handoff tidak disentuh, hanya markup. Tab "Pengurus dan staf" dan "Anggota". Pemilihan koperasi tetap lewat `TenantPickerDialog` yang sudah ada. Tab Anggota hanya menjelaskan NIK dan menautkan `/anggota/login` (UI login anggota tidak ada di repo frontend ini; tautan itu sudah ada sebelumnya); tidak ada alur NIK baru yang dikarang.

Penyimpangan dari design.md yang disengaja:
- Dialog tinjau Setor TIDAK menyebut "dibatalkan (void) oleh manajer": tidak ada endpoint void untuk transaksi simpanan (hanya pembalikan jurnal manual). Teks diganti dengan fakta: tercatat langsung dan tidak bisa diubah dari layar ini, hubungi manajer untuk koreksi.
- "Kasir toko" di sidebar tetap ke `/ksu/toko` (bukan /ksu/units/:id/pos) karena TokoPage menyelesaikan unitnya; POS dicapai dari sana seperti sebelumnya.

Pemeriksaan peramban nyata (Puppeteer + mock /api): Beranda 1366x768 panel penuh terlihat (bawah 763/768 px dengan 5 tugas + "lihat lainnya"; dengan <= 4 tugas lebih longgar); alur setor 4 interaksi, 1,5 dtk otomatis, kolom nominal otomatis fokus, dialog fokus ke Posting, struk lengkap, tarik melebihi saldo ditolak inline, peran baca-saja melihat penjelasan; stepper pinjaman sampai Ajukan; POS 390px bar 56px dan lembar bawah; login 390px tanpa gulir horizontal.

Tes baru: attention (7), saving-flow (11), format (ringkas, jam WIB, NIK). Total 196 lulus. Gerbang: tsc 0, eslint 0, vitest 196/196, vite build sukses.

## Fase 6: Halaman prioritas 2 dan 3 (selesai)

- **Sapuan warna lama**: 18 berkas memakai hijau/merah/kuning/oranye/biru/abu bawaan Tailwind; semuanya dipetakan ke token (success, destructive, warning, info, muted, border), varian `dark:` yang berlebihan dibuang. `grep` untuk `(slate|gray|zinc|green|emerald|amber|yellow|orange|red|blue|purple|teal)-NNN` di luar situs pemasaran kini kosong.
- **Hub Pengaturan** (`pages/config/ConfigPage.tsx`): 14 tab menjadi navigasi samping dalam 4 grup (Koperasi, Akuntansi, Akses dan keamanan, Tampilan dan alamat); bagian aktif di `?tab=`; <= 900px memakai satu pemilih bawaan (`<select>` dengan optgroup). Isi form tiap bagian tidak berubah. Judul halaman "Konfigurasi" menjadi "Pengaturan" (sama dengan menu).
- **Tutup buku**: konsekuensi ditulis dengan bahasa biasa (pendapatan dan beban dinolkan ke ekuitas, jurnal manual tahun itu dikunci, bisa dibuka kembali lewat jurnal pembalik), tombol akhir `destructive` dan baru aktif setelah tahun diketik. Status memakai Badge bermarka.
- **Jurnal manual**: "Tinjau dan catat jurnal" membuka konfirmasi dua langkah yang menyebut jenis, tanggal, total, dan bahwa jurnal tidak bisa diubah/dihapus (koreksi lewat jurnal pembalik). Peran tanpa izin melihat EmptyState terkunci.
- **Laporan**: `ReportResultCard` memakai EmptyState (belum memilih periode, tidak ada data); judul laporan sentence case.
- **Keadaan lintas halaman**: `PageLoading` kini kerangka berbentuk halaman (judul, tiga ubin, tabel), bukan spinner; halaman detail Anggota/Simpanan/Pinjaman yang tidak ditemukan memakai EmptyState dengan tautan kembali; Unit Usaha tidak ditemukan; judul 25 halaman dibuat sentence case.
- **PageHeader**: tingkat judul dari konteks, halaman di dalam tab unit usaha memakai h2 sehingga hanya ada satu h1.
- **Pendaftaran mandiri publik** (`PublicRegistrationPage`): landmark `main`, h1, label terhubung ke input (7 kolom), pesan galat `role=alert`, target sentuh 44px.
- **Primitif lain**: AlertDialog, Select, Dropdown, Tooltip, Tabs, Textarea mengikuti token, radius, skala z-index; TabsList bisa digulir mendatar di layar sempit.
- **Platform Admin, Rekening Koran, Kolektor pasar, Laporan Pasar, Piutang, Beban umum, Unit usaha, dll.**: memakai sistem lewat primitif, DataTable, PageHeader, dan sapuan token di atas; struktur halamannya tidak ditulis ulang.

Yang TIDAK dikerjakan (jujur):
- **Portal anggota mobile**: tidak ada UI portal anggota di repo frontend ini (hanya tautan `/anggota/login`); tidak dibuat dari nol karena itu fitur baru, bukan lapisan presentasi.
- **Kolektor pasar mobile** (`/market`, 923 baris) dan **Rekening Koran/cetak**: dapat tampilan baru dari token dan primitif tetapi tata letaknya belum dirancang ulang khusus ponsel; perlu uji manual di perangkat.
- Situs pemasaran/onboarding (`features/onboarding`: Landing, Register, Checkout) tetap memakai gaya hijau hutan sendiri; bukan bagian dari mockup. Lihat Fase 7.

Pemeriksaan peramban nyata (Puppeteer, mock /api): merayapi 35 rute tenant dan 5 rute platform pada 1366 dan 390 px dalam keadaan galat; tidak ada kerusakan halaman dan tidak ada gulir horizontal. Dalam keadaan data kosong semua halaman daftar menampilkan keadaan kosong; sisa kerusakan hanya pada halaman yang menerima `[]` padahal API mengembalikan objek (artefak mock, bukan perilaku API nyata).

Gerbang: tsc 0, eslint 0, vitest 196/196, vite build sukses.

## Fase 7: Penutup (selesai)

**Aksesibilitas**
- `lib/token-contrast.test.ts` membaca nilai token langsung dari `index.css` dan menegaskan kontras WCAG di terang dan gelap: 18 pasangan teks >= 4,5:1, teks status pada badge bertint, angka di segmen KOL, dan batas kolom isian/cincin fokus >= 3:1. 48 pernyataan lulus.
- **Penyimpangan dari design.md yang disengaja**: `--input` diubah dari `220 12% 78%` (1,7:1 di atas kartu) ke `220 10% 56%` (3,4:1), dan di gelap dari `224 12% 32%` (2,1:1) ke `224 12% 46%` (3,6:1), karena batas kolom isian harus >= 3:1 (WCAG 1.4.11) dan kriteria penerimaan menuntut WCAG 2.2 AA. Efek visual: garis kolom dan tombol outline sedikit lebih tegas. Jika pemilik produk lebih memilih garis lembut, ubah satu nilai itu (dan tes akan memberi tahu).
- Pemindaian skrip atas semua `<Button>/<button>` ikon-saja: satu tanpa nama (hapus foto KTP) sudah diperbaiki; sisanya sudah ber-`aria-label`/`title`/teks sr-only.
- KTP lightbox kini Dialog sungguhan (fokus terkurung, Esc, judul dan deskripsi), bukan overlay manual. Pemilih koperasi (TenantPickerDialog) memakai gaya baru.
- Terverifikasi di peramban: tautan "Lewati ke konten" adalah perhentian Tab pertama dan memindahkan fokus ke konten; setelahnya fokus ke sidebar; `prefers-reduced-motion` menciutkan transisi (1e-5 dtk).
- Sudah ada dari fase sebelumnya: aria pada dialog (Radix), tabel semantik + aria-label, toast (role status), meter (role meter + nilai), stepper (aria-current=step), nav aktif (aria-current=page), combobox palet/pemilih anggota.

**White-label** (`lib/brand.ts`, `BrandStyle`, `WhitelabelConfigTab`): satu warna merek menimpa `--brand`, `--ring`, dan tint `--accent` (terang dan varian gelap); `--primary` tidak disentuh. Warna dengan kontras teks putih < 4,5:1 ditolak, pesan menyebut kontras terukur ("1,2:1, minimal 4,5:1"), tombol Simpan diblokir, dan warna gagal tidak pernah diterapkan. Pratinjau langsung saat mengetik. Warna tersimpan diterapkan ke seluruh aplikasi oleh `BrandStyle` untuk peran yang boleh membaca konfigurasi (peran lain memakai indigo bawaan karena endpoint konfigurasi memerlukan izin config:read). Diverifikasi di peramban dengan teal #0F766E (5,5:1 lulus), kuning #FFEB3B (1,2:1 ditolak), ungu #7C3AED (pratinjau). 12 tes di `brand.test.ts`.
- **Logo**: TIDAK dikerjakan. `WhitelabelConfig` dan API tidak punya kolom/unggahan logo; membuatnya berarti mengubah API. Dicatat sebagai pertanyaan terbuka.

**Audit sisa gaya lama**: `slate-/zinc-/gray-/green-/amber-/red-...` di luar situs pemasaran: 0 (sisa yang cocok hanya komentar dan `translate-x`); `bg-white`/`bg-black`: 0; `any`: 0; sidebar tanpa `bg-slate`; gaya inline hanya 15 nilai dinamis (lebar meter, indentasi, warna seri dari token). Heks tersisa hanya di placeholder/tes/pemeriksa warna dan di CSS situs pemasaran.
- **Situs pemasaran/onboarding** (`features/onboarding`, Landing/Register/Checkout): tidak ada di mockup, jadi bukan ditulis ulang. Namun palet hijau hutannya dipindahkan secara mekanis ke ink + indigo (50 nilai warna di `styles.css` digeser huenya, `theme-color` meta jadi #0d0f15, gambar hero dan kanvas Spline diberi `hue-rotate`). Tata letaknya tidak berubah. Diverifikasi lewat tangkapan layar Landing.

**Keadaan layar**: memuat (skeleton: PageLoading, DataTable, StatCard, panel perhatian, drawer, pemilih anggota), kosong (EmptyState di DataTable, laporan, POS, pencarian), galat (pesan manusiawi + Coba lagi di DataTable, panel beranda, drawer, Langganan, Tutup buku), terkunci (LockedFeature halaman dan inline; item sidebar), hanya-baca (Setor dan tarik, Jurnal manual: penjelasan peran). Halaman lama yang belum disentuh strukturnya mewarisi keadaan lewat DataTable/PageLoading; tidak semua layar lama punya kelima keadaan secara eksplisit (lihat risiko di laporan akhir).

**Tes dan gerbang akhir**: tsc 0, eslint 0, vitest 257/257 (23 berkas; baseline sebelum UI v3: 132), vite build sukses.
