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
| 2 Primitif | belum | |
| 3 Shell | belum | |
| 4 DataTable | belum | |
| 5 Halaman P1 | belum | |
| 6 Halaman P2/P3 | belum | |
| 7 Penutup | belum | |

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
