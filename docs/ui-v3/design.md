# SISKOP v3: Design System

Acuan pengembangan UI baru SISKOP. Sumber visual: `siskop-v3-mockup.html` (versi putih bersih). Kalau dokumen ini dan mockup berbeda, mockup menang untuk tampilan, dokumen ini menang untuk aturan.

Stack tidak berubah: React 18, TypeScript, Vite, Tailwind 3.4, shadcn/ui di atas Radix, lucide-react, react-hook-form + zod, TanStack Query, Recharts, zustand, react-router v6. Ini redesign lapisan presentasi saja. API dan logika tidak disentuh. Semua teks UI Bahasa Indonesia.

---

## 1. Prinsip

1. **Tenang, bukan dingin.** Ini tabungan orang. Putih bersih, banyak ruang napas, satu warna aksen. Tidak neon, tidak abu-abu korporat.
2. **Keputusan dulu, angka kemudian.** Dasbor menjawab "apa yang perlu saya putuskan hari ini", bukan memamerkan statistik.
3. **Uang tidak boleh ambigu.** Setiap transaksi uang punya langkah tinjau sebelum posting, lalu struk. Angka selalu rata kanan dan tabular.
4. **Satu pola untuk satu masalah.** Satu pola terkunci, satu hierarki umpan balik, satu pola konfirmasi destruktif. Jangan membuat varian baru per halaman.
5. **Status tidak pernah hanya warna.** Setiap badge status punya bentuk penanda dan teks.
6. **Kecepatan teller dulu.** Urutan prioritas persona: teller, manajer, akuntan, kasir dan kolektor, anggota, platform admin.

Rasional: masalah §3 brief (tampilan generik, navigasi terkubur, input uang rawan salah, aksesibilitas).

---

## 2. Token warna

Semua token HSL tanpa fungsi `hsl()`, memakai nama shadcn, dipakai sebagai `hsl(var(--nama))`. Tambahan: `--brand`, `--success`, `--warning`, `--info`, `--hero-*`, `--chart-*`.

### 2.1 Terang (`:root`)

| Token | HSL | Fungsi |
|---|---|---|
| `--background` | `220 20% 98%` | Latar halaman |
| `--foreground` | `224 30% 11%` | Teks utama |
| `--card` / `--card-foreground` | `0 0% 100%` / `224 30% 11%` | Kartu, tabel, popover |
| `--muted` | `220 16% 95%` | Latar header tabel, segmented, chip tenang |
| `--muted-foreground` | `220 10% 38%` | Teks sekunder |
| `--primary` / `--primary-foreground` | `224 30% 12%` / `0 0% 100%` | Tombol utama, nav aktif, stepper |
| `--brand` | `233 62% 50%` | Aksen: tombol aksi cepat, logo, fokus |
| `--accent` / `--accent-foreground` | `233 80% 96%` / `233 55% 32%` | Tint indigo: avatar, angka prioritas, ikon latar |
| `--border` | `220 14% 90%` | Garis kartu, tabel, pemisah |
| `--input` | `220 12% 78%` | Garis input |
| `--ring` | `233 62% 50%` | Cincin fokus |
| `--destructive` | `4 66% 42%` | Bahaya |
| `--success` | `150 62% 26%` | Berhasil, lancar |
| `--warning` | `34 92% 30%` | Peringatan |
| `--info` | `212 62% 36%` | Informasi |
| `--hero` / `--hero-foreground` / `--hero-muted` / `--hero-line` | `0 0% 100%` / `224 30% 11%` / `220 10% 40%` / `220 14% 91%` | Panel "Perlu perhatian hari ini" |
| `--sidebar` / `--sidebar-foreground` / `--sidebar-active` | `0 0% 100%` / `224 30% 14%` / `220 20% 96%` | Sidebar |
| `--chart-1` / `--chart-2` | `224 30% 12%` / `30 85% 38%` | Seri grafik |
| `--radius` | `14px` | Radius dasar |

### 2.2 Gelap (`.dark`)

| Token | HSL |
|---|---|
| `--background` | `224 22% 7%` |
| `--foreground` | `220 20% 94%` |
| `--card` / `--card-foreground` | `224 20% 10%` / `220 20% 94%` |
| `--muted` / `--muted-foreground` | `224 16% 15%` / `220 12% 68%` |
| `--primary` / `--primary-foreground` | `0 0% 96%` / `224 30% 10%` |
| `--brand` | `233 85% 74%` |
| `--accent` / `--accent-foreground` | `233 40% 20%` / `233 85% 88%` |
| `--border` / `--input` / `--ring` | `224 14% 19%` / `224 12% 32%` / `233 85% 74%` |
| `--destructive` / `--success` / `--warning` / `--info` | `4 80% 68%` / `150 55% 60%` / `38 90% 62%` / `208 80% 72%` |
| `--hero` / `--hero-foreground` / `--hero-muted` / `--hero-line` | `224 20% 10%` / `220 20% 94%` / `220 12% 68%` / `224 14% 19%` |
| `--sidebar` / `--sidebar-foreground` / `--sidebar-active` | `224 22% 8%` / `220 18% 90%` / `224 18% 14%` |
| `--chart-1` / `--chart-2` | `233 85% 78%` / `36 90% 62%` |

Di mode gelap, teks di atas `--brand` memakai tinta gelap (`224 30% 10%`), bukan putih.

### 2.3 Kontras terukur (WCAG 2.2 AA)

Dihitung dari nilai HSL di atas. Syarat: teks biasa 4,5:1, teks besar dan komponen UI 3:1.

| Pasangan | Terang | Gelap |
|---|---|---|
| foreground / background | 16,9 | 16,5 |
| muted-foreground / card | 6,5 | 7,7 |
| muted-foreground / muted | 5,8 | n/a |
| primary-foreground / primary | 17,3 | 16,6 |
| teks pada `--brand` | 7,4 (putih) | 6,4 (tinta) |
| accent-foreground / accent | 10,2 | 9,7 |
| success / card | 6,5 | 9,5 |
| warning / card | 5,9 | 9,9 |
| destructive / card | 6,4 | 6,3 |
| info / card | 7,2 | 8,8 |

### 2.4 Kolektibilitas (KOL)

Lima tingkat, selalu ditulis "KOL n Nama". Warna hanya pendukung.

| KOL | Nama | Badge | Penanda |
|---|---|---|---|
| 1 | Lancar | success | bulat |
| 2 | Dalam perhatian | info | kotak |
| 3 | Kurang lancar | destructive | segitiga |
| 4 | Diragukan | destructive | segitiga |
| 5 | Macet | destructive | segitiga |

Grafik sebaran KOL memakai lima warna berbeda ditambah angka tingkat di dalam segmen dan legenda bertulis.

### 2.5 White-label per tenant

Tenant mengganti dua hal: logo dan satu warna merek. Warna merek hanya menimpa `--brand` dan `--ring` (dan turunan `--accent`). Validasi saat simpan: kontras teks putih pada `--brand` minimal 4,5:1 di mode terang. Jika gagal, tolak dan tampilkan kontras terukur. `--primary` (tinta) tidak dipengaruhi, jadi tombol utama tetap terbaca.

---

## 3. Tipografi

Font tunggal: **Manrope** (sudah dibundel). Tidak ada font eksternal lain.

| Peran | Ukuran / tinggi baris | Bobot | Catatan |
|---|---|---|---|
| Judul halaman | 26 / 1,15 | 800 | letter-spacing -0,02em |
| Judul kartu | 15 / 1,3 | 800 | |
| Angka KPI | 24 / 1,2 | 800 | -0,02em |
| Angka besar (nominal, total) | 28 sampai 30 | 800 | input uang dan struk |
| Isi | 14 / 1,45 | 400 sampai 500 | |
| Label field, nav | 13 sampai 13,5 | 600 sampai 700 | |
| Teks bantu, breadcrumb | 12,5 | 500 sampai 600 | |

Aturan:
- Semua angka uang: `font-variant-numeric: tabular-nums` (kelas `.money` / `tabular-nums`).
- Kalimat huruf kecil biasa (sentence case). Tidak ada label HURUF KAPITAL, tidak ada eyebrow di atas judul.
- Panjang baris di bawah 80 karakter.

---

## 4. Ruang, bentuk, bayangan

- **Grid spasi:** kelipatan 4 px. Jarak kartu 14 px, padding kartu 18 px, padding halaman 22 x 24 px (desktop), 16 x 14 px (mobile).
- **Radius (bertingkat, bukan satu untuk semua):** kartu 16, panel hero 20, modal 20, input dan tombol 10, tombol kecil 8, badge 7, chip dan pil 999, avatar bulat.
- **Elevasi:** permukaan datar dengan garis 1 px `--border`. Bayangan hanya untuk lapisan yang melayang: popover, modal, drawer, palet perintah. Kartu biasa tidak punya bayangan.
- **Skala z-index:** sidebar 30, topbar 20, popover 40, scrim 50, drawer 51, modal dan palet 52, toast 70.

---

## 5. Ikon dan gerak

- Ikon: `lucide-react`, stroke 1,75, ukuran 18 px (13 px untuk breadcrumb). Tombol hanya-ikon wajib punya `aria-label`.
- Gerak hanya untuk respons ke aksi pengguna (buka drawer, modal, toast), durasi 140 sampai 220 ms. Tidak ada animasi masuk otomatis pada kartu atau section.
- `prefers-reduced-motion: reduce` mematikan semua animasi dan transisi.

---

## 6. Layout dan breakpoint

| Breakpoint | Perilaku |
|---|---|
| ≥ 1181 px | Sidebar 248 px (atau rail 72 px), konten maks 1500 px, dasbor dua kolom 5:7 |
| 901 sampai 1180 px | Dasbor dan form jadi satu kolom, ringkasan tidak lagi sticky |
| ≤ 900 px | Sidebar jadi drawer dari kiri, tabel jadi kartu, tombol menu muncul |
| ≤ 520 px | Bingkai ponsel POS dilepas, KPI satu kolom |

Target sentuh minimal 44 px di mobile. POS memakai 56 px untuk tombol Bayar dan 40 px untuk chip filter.

---

## 7. App shell

### 7.1 Sidebar

Grup berorientasi tugas (bukan nama modul), satu level, tidak ada akordeon:

| Grup | Item |
|---|---|
| Harian | Beranda, Setor dan tarik, Kasir toko |
| Anggota | Daftar anggota, Pinjaman baru, Koperasi Pasar |
| Keuangan | Jurnal dan Tutup Buku |
| Laporan | Laporan keuangan |
| Pengaturan | Langganan, Pengaturan |

- Label grup: teks kecil 12 px tebal, bukan huruf kapital.
- Item aktif: latar `--sidebar-active` dan garis kiri 3 px `--primary`, plus `aria-current="page"`.
- Item terkunci paket: ikon gembok di kanan, tetap bisa diklik, membuka halaman terkunci (bagian 9.4). Tidak pernah tautan mati.
- Mode rail 72 px: hanya ikon, label jadi `title`, grup jadi garis pemisah.
- Kaki sidebar: kartu tenant (nama koperasi, paket, meter kuota anggota).
- Menu muncul sesuai izin peran. Item yang tidak diizinkan tidak ditampilkan (beda dengan terkunci paket).

### 7.2 Topbar (tinggi 60 px, sticky)

Kiri ke kanan: tombol rail, kotak pencarian (membuka palet perintah, `Ctrl/⌘ K`), spacer, pemilih unit, tombol aksi cepat "Setor simpanan", lonceng notifikasi, tema, avatar pengguna.

- **Pemilih unit hanya tampil jika tenant punya lebih dari satu unit usaha.** Tidak pernah merancang sakelar "KSU vs KSP".
- Aksi cepat berubah menurut peran: teller "Setor simpanan", manajer "Anggota baru", kasir "Transaksi baru". Maksimal 5 di menu.

### 7.3 Palet perintah (`Ctrl/⌘ K`)

Tiga grup: Aksi cepat (Setor simpanan, Pinjaman baru, Anggota baru), Halaman, Anggota (cari nama, nomor, atau NIK). Panah atas/bawah pilih, Enter buka, Esc tutup. Semua halaman terjangkau dengan satu tombol.

### 7.4 Header halaman

Breadcrumb di atas, judul 26 px, deskripsi satu kalimat, aksi utama di kanan (satu tombol utama, sisanya outline). Tab atau segmented control di bawah header bila perlu.

---

## 8. Komponen

Semua dibuat dengan `cva`, `cn()`, dan primitif Radix. Pakai ulang yang sudah ada di `@/components/shared/*` dan `@/components/ui/*` bila bisa, ubah gayanya lewat token.

| Komponen | Varian dan aturan |
|---|---|
| **Button** | `primary` (tinta), `brand` (aksi cepat), `outline`, `ghost`, `destructive`. Ukuran: sm 32, default 38, lg 48. Keadaan: hover, fokus, disabled (opasitas .45), loading. |
| **Input** | Tinggi 42, radius 10, garis `--input`, fokus: cincin 2 px `--ring`. Error: garis `--destructive` plus pesan dengan ikon. |
| **MoneyInput** | Tinggi 62, awalan "Rp", teks 28 px 800, rata kanan, tabular. Pengelompokan ribuan langsung saat mengetik (`1.250.000`), menyimpan angka murni. Chip nominal cepat di bawahnya. Validasi inline (mis. saldo kurang). |
| **MemberPicker** | Cari nama, nomor, atau NIK. Hasil maks 4, tiap baris avatar, nama, nomor, saldo. Setelah dipilih jadi kartu ringkas dengan tombol "Ganti". |
| **Badge** | Status: ok, warn, bad, info. Selalu ada penanda bentuk (bulat, belah ketupat, segitiga, kotak) dan teks. |
| **KOLBadge** | Bagian 2.4. |
| **Card / StatCard** | Garis 1 px, tanpa bayangan. StatCard: label, nilai, delta dengan ikon dan teks ("Naik 2,1% dari September"). |
| **DataTable** | Lihat 8.1. |
| **Drawer** | Lebar maks 460 px dari kanan, `role="dialog"`, `aria-modal`, tutup dengan Esc, scrim, atau tombol. Untuk detail anggota. |
| **Dialog** | Lebar maks 480 px. Judul, satu kalimat konsekuensi, dua tombol (kembali dan aksi). |
| **Toast** | Kanan bawah, `role="status"`, hilang sendiri 3 detik. Hanya untuk umpan balik tak memblokir. |
| **Banner** | Tingkat sistem (jurnal belum diposting, tagihan jatuh tempo). Dapat ditutup, tidak menutup konten. |
| **EmptyState** | Ikon, judul, satu kalimat yang mengajarkan langkah berikutnya, satu tombol. |
| **LockedFeature** | Bagian 9.4. |
| **QuotaMeter** | Label, `n/total`, batang 6 px dengan `role="meter"`. Warna: normal `--success`, ≥ 85% `--warning`, 100% `--destructive`. Selalu ada angka dan teks, bukan warna saja. |
| **GlossaryTerm** | Garis bawah titik-titik. Muncul pada hover dan fokus keyboard (`tabindex="0"`), `role="tooltip"`. Satu kalimat Bahasa Indonesia sederhana. Istilah wajib: KOL, NPL, SHU, CALK, BMPP, Modal Sendiri, Simpanan Pokok, Wajib, Sukarela. |
| **Stepper** | Pil per langkah, langkah aktif ber-`aria-current="step"`, langkah selesai bercentang. |
| **CommandPalette** | Bagian 7.3. |
| **Sidebar / Topbar** | Bagian 7. |

### 8.1 DataTable

- Header lengket di bawah topbar (`position: sticky; top: 60px`), latar solid `--muted`. Pembungkus kartu memakai `overflow: clip`, **bukan** `overflow: hidden`, karena `hidden` menjadikannya area gulir dan merusak sticky (bug yang pernah terjadi).
- Kolom uang: header dan sel rata kanan, `tabular-nums`. Untuk menimpa `text-align` header, pakai selektor `th.right`.
- Filter berupa chip dengan jumlah. Kepadatan: Nyaman dan Padat. Baris bisa diklik dan membuka drawer, nama di baris juga tombol (untuk keyboard).
- Di ≤ 900 px: header disembunyikan, tiap baris jadi kartu dua kolom dengan label dari `data-label`.
- Footer: jumlah tampil, paginasi, menu ekspor (PDF, CSV).

---

## 9. Pola lintas halaman

### 9.1 Input dan posting uang

Urutan baku: **pilih anggota, isi nominal, tinjau, posting, struk.** Tidak ada transaksi uang yang langsung tercatat tanpa dialog tinjau. Dialog tinjau menyebut anggota, jenis, nominal, saldo setelah transaksi, dan bahwa transaksi yang sudah diposting hanya bisa dibatalkan (void) oleh manajer.

Target: setor simpanan selesai dalam 4 interaksi (pilih anggota, ketik nominal, Tinjau, Posting) dan kurang dari 30 detik.

### 9.2 Struk dan keadaan sukses

Ikon centang, "Setoran berhasil diposting", nomor transaksi, tanggal (`29 Okt 2026, 21:35 WIB`), anggota, jenis, saldo setelah transaksi, petugas, total besar. Aksi: Cetak struk, Bagikan, "Transaksi berikutnya" (tombol utama). Gaya cetak (`@media print`) hanya menampilkan struk.

### 9.3 Hierarki umpan balik

Dari yang paling ringan ke paling berat: **kesalahan inline pada field, peringatan section, toast, banner sistem, dialog pemblokir.** Pilih tingkat terendah yang cukup.

### 9.4 Terkunci paket

Satu pola: ikon gembok, judul "{Fitur} belum termasuk di {Paket Anda}", satu kalimat apa fitur itu, paket mana yang membukanya, satu tombol utama "Lihat paket" dan satu tombol ghost "Kembali ke beranda". Latar menampilkan siluet halaman yang dikaburkan. Catatan kecil: siapa yang bisa mengubah paket dan bahwa data tidak berubah. Tidak pernah tautan mati.

### 9.5 Aksi destruktif dan tak bisa dibatalkan

Void, Tutup Buku, hapus: konfirmasi dua langkah atau ketik nama untuk mengonfirmasi, dengan konsekuensi ditulis dalam bahasa biasa. Tombol destruktif memakai `destructive`, bukan primary.

### 9.6 Kosong, memuat, galat

- **Memuat:** kerangka (skeleton) berbentuk seperti konten akhir.
- **Kosong:** mengajarkan langkah berikutnya, bukan "Tidak ada data".
- **Galat:** penjelasan manusiawi, tombol Coba lagi, tanpa stack trace.
- **Hanya-baca:** kontrol dinonaktifkan dengan alasan di teks bantu.
- Setiap layar punya lima keadaan: memuat, kosong, galat, terkunci, hanya-baca.

### 9.7 Format data

- Uang: `Rp 1.250.000`, tanpa desimal kecuali perlu. Negatif: tanda minus plus warna, di tampilan akuntansi boleh tanda kurung. Tidak pernah warna saja. Di KPI besar boleh dipadatkan (`Rp 412,8 jt`, `Rp 2,18 M`) dengan nilai penuh tersedia di tabel alternatif.
- Tanggal: `dd MMM yyyy` lokal Indonesia (`29 Okt 2026`), zona Asia/Jakarta, jam dengan `WIB`.
- NIK ditampilkan tersamar (`3174••••••0012`).

### 9.8 Grafik (Recharts)

- Label langsung di ujung garis, bukan legenda.
- Aman buta warna: bedakan seri dengan pola garis (padat vs putus-putus) selain warna.
- Selalu sediakan fallback tabel ("Lihat sebagai tabel") dan `aria-label` yang menyebut nilai awal dan akhir.
- Tooltip seragam. Sumbu memakai satuan ringkas (`2,0 M`).

### 9.9 Notifikasi

Lonceng dengan jumlah, daftar dikelompokkan, tiap item bisa ditindak langsung (pendaftaran anggota: Setujui atau Tolak).

---

## 10. Layar

Peta layar mockup ke rute. Rute tidak berubah, hanya tampilan.

| Layar | Rute | Inti rancangan |
|---|---|---|
| Login | `/login` | Dua tab: Pengurus dan staf (pilih koperasi, surel, sandi), Anggota (NIK 16 digit, sandi). Panel kanan tenang dengan dua lingkaran bertaut. |
| Beranda manajer | `/dashboard` | Kiri: panel "Perlu perhatian hari ini" (empat tugas berurut risiko, tiap tugas punya jumlah, penjelasan, tombol). Kanan: empat KPI, grafik tren. Bawah: sebaran KOL dan transaksi terakhir. Bagian "perlu perhatian" muat dalam satu layar 1366x768 tanpa gulir. |
| Daftar anggota | `/members` | Tabel (8.1), drawer detail: simpanan per jenis, pinjaman dengan KOL, riwayat, tombol Setor, Tarik, Pinjaman baru. |
| Setor dan tarik | `/savings/new` | Dua kolom: form bertahap di kiri, ringkasan lengket di kanan, dialog tinjau, lalu struk. |
| Pinjaman baru | `/loans/new` | Stepper empat langkah: Anggota, Produk dan syarat, Jadwal, Tinjau. Footer lengket. Tombol Ajukan aktif setelah centang pemeriksaan. |
| Kasir toko | `/ksu/units/:id/pos` | Mobile-first. Grid barang dua kolom, total dan tombol Bayar di dasar, lembar bawah untuk metode bayar. |
| Langganan | `/langganan` | Kartu paket aktif, daftar fitur termasuk dan tidak, kuota, tagihan. |
| Koperasi Pasar (terkunci) | `/market` | Pola 9.4. |

Belum dirancang (prioritas 2 dan 3, pakai sistem yang sama): laporan dan Neraca, Rekening Koran, Jurnal Manual dan Tutup Buku, hub Pengaturan (ganti 13 tab dengan tata letak navigasi samping), Kolektor pasar mobile, pendaftaran mandiri anggota, portal anggota, Platform Admin.

---

## 11. Aksesibilitas

- Target WCAG 2.2 AA. Kontras sesuai 2.3.
- Fokus terlihat konsisten: cincin 2 px `--ring`, offset 2 px, di semua kontrol.
- Navigasi keyboard: `Ctrl/⌘ K` palet, `Esc` tutup lapisan, panah di palet, `Enter` pada baris tabel membuka drawer.
- ARIA: tabel memakai `<table>` semantik, dialog `role="dialog"` + `aria-modal` + `aria-labelledby`, toast `role="status"` `aria-live="polite"`, meter `role="meter"` dengan `aria-valuenow` dan `aria-valuemax`, nav aktif `aria-current="page"`, stepper `aria-current="step"`.
- Urutan fokus shell: lompat ke konten, sidebar, topbar, konten. Tambahkan tautan "Lewati ke konten" di implementasi nyata (belum ada di mockup).
- Tombol hanya-ikon wajib bernama. Status tidak pernah hanya warna.

---

## 12. Pemetaan ke Tailwind dan kode

Letakkan token di `apps/frontend/src/index.css` (`:root` dan `.dark`, nilai pada bagian 2). Tailwind memetakan:

```js
// apps/frontend/tailwind.config.js, theme.extend
colors: {
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
  muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
  primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
  accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
  brand: 'hsl(var(--brand))',
  destructive: 'hsl(var(--destructive))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  info: 'hsl(var(--info))',
  border: 'hsl(var(--border))',
  input: 'hsl(var(--input))',
  ring: 'hsl(var(--ring))',
  sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', active: 'hsl(var(--sidebar-active))' },
},
borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 4px)', sm: 'calc(var(--radius) - 6px)' },
fontFamily: { sans: ['Manrope', 'system-ui', 'sans-serif'] },
```

Aturan kode: TypeScript strict, tanpa `any`, komponen fungsional, ekspor bernama, hanya kelas Tailwind (gaya inline hanya untuk nilai dinamis), impor lewat alias `@/`.

---

## 13. Migrasi

Bisa bertahap di balik rute yang sama:

1. **Token dulu:** ganti blok `:root` dan `.dark`, tambah `brand`, `success`, `warning`, `info`. Seluruh aplikasi langsung berubah warna tanpa ubah halaman. Risiko rendah.
2. **Primitif:** `components/ui/*` (Button, Input, Badge, Dialog) menyesuaikan varian. Tambah `MoneyInput`, `QuotaMeter`, `GlossaryTerm`, `LockedFeature`, `Stepper`.
3. **Shell:** `components/layout/{AppLayout,Sidebar,Topbar}.tsx` (grup baru, rail, palet perintah, aksi cepat). Risiko sedang: menyentuh semua halaman, uji dengan izin peran dan paket berbeda.
4. **Halaman prioritas 1** satu per satu: Beranda, Anggota, Setor, Pinjaman baru, POS, Langganan, Login.
5. **Prioritas 2 dan 3** memakai sistem yang sudah ada.

Paling berisiko: DataTable bersama (dipakai banyak halaman, ubah di satu tempat lalu uji semua), pemilih unit bersyarat (harus bergantung pada jumlah unit usaha), dan white-label (validasi kontras).

---

## 14. Asumsi dan pertanyaan terbuka

- Data di mockup (nama, nominal, jumlah anggota, nama paket "Tumbuh" dan "Usaha") hanya contoh. Nama paket dan isi tiap paket perlu dicocokkan dengan `PRICING-V2-ROLLOUT.md`.
- Dasbor menampilkan empat tugas perhatian. Daftar pasti per peran (dan sumber datanya di API) perlu dikonfirmasi.
- Metode bayar POS ("Tunai", "Non-tunai") adalah generik. Metode sebenarnya perlu diselaraskan dengan PRD.
- Rumus angsuran di mockup bunga flat dari plafon. Metode hitung asli (flat, anuitas, efektif) mengikuti produk pinjaman di sistem.
- Aksen indigo dipilih agar bersih dan netral. Jika identitas merek ingin lebih dekat ke situs pemasaran, cukup ganti `--brand` dan `--accent`.
- "Lewati ke konten", skeleton, keadaan galat, dan keadaan hanya-baca dirancang di dokumen ini tetapi belum digambar di mockup.
- Mockup belum diuji di perangkat mobile sungguhan dan pembaca layar.
