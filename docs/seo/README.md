# SEO dan AEO landing page

Landing page (`/` di `apps/frontend`) di-prerender saat build, jadi HTML awal sudah berisi h1, definisi,
tabel paket, FAQ, dan JSON-LD. Crawler AI umumnya tidak menjalankan JavaScript, jadi ini yang membuat
isi halaman bisa dibaca dan dikutip.

## Cara kerja

| Bagian | File |
|---|---|
| Teks SEO/AEO (judul, deskripsi, definisi, FAQ, tanggal, penerbit) | `apps/frontend/src/seo/content.ts` |
| Plugin Vite: head, prerender, robots, sitemap, pricing.md, llms.txt, 404 | `apps/frontend/vite-plugins/seo.ts` |
| Render landing ke HTML (Node, tanpa browser) | `apps/frontend/src/seo/prerender.tsx` |
| JSON-LD, robots.txt, sitemap, head tags | `apps/frontend/src/seo/jsonld.ts`, `files.ts`, `site.ts` |
| Bagian halaman (definisi, tabel, FAQ) | `features/onboarding/components/LandingSeo.tsx` |

`index.html` hanya berisi placeholder `<!--seo-head-->`, `<!--seo-app-->`, `<!--seo-state-->`; plugin
mengisinya. Browser memakai `hydrateRoot` hanya di `/` pada host pusat (bukan subdomain koperasi);
path lain mulai bersih.

## Environment

| Variabel | Fungsi |
|---|---|
| `SITE_URL` | Origin domain produksi, mis. `https://siskop.co.id`. Dasar canonical, OG, sitemap, JSON-LD. |
| `PRICING_API_URL` | Opsional. Katalog harga publik untuk tabel, `pricing.md`, dan Offer JSON-LD. Default `$SITE_URL/api/public/pricing`. |

Keduanya dibaca dari environment proses atau `.env*` saat `vite build`. Tidak ada domain yang ditulis di kode.

## Noindex otomatis di staging

`SITE_URL` kosong, tidak valid, bukan `https`, atau host-nya `*.netlify.app`, `*.vercel.app`, `*.web.app`,
`*.firebaseapp.com`, `localhost`, `127.0.0.1` berarti build dianggap staging:

- `<meta name="robots" content="noindex, nofollow">` ditambahkan.
- `robots.txt` berisi `Disallow: /`, tanpa `Sitemap`, dan `sitemap.xml` tidak dibuat.

Di domain final (build dengan `SITE_URL` produksi) semuanya hilang sendiri: tidak ada meta noindex,
`robots.txt` mengizinkan crawler, `sitemap.xml` dibuat. Subdomain koperasi yang menyajikan build yang sama
tetap di-noindex lewat skrip kecil di `<head>` yang membandingkan hostname dengan `SITE_URL`.

Header `X-Robots-Tag` **tidak** diatur di sini: `firebase.json` statis dan tidak bisa bergantung pada
environment. Meta noindex dan `robots.txt` sudah cukup untuk staging. Kalau header tetap diinginkan,
tambahkan `X-Robots-Tag: noindex, nofollow` ke `firebase.json` untuk staging dan hapus saat go-live.

## Kebijakan crawler (robots.txt)

Diizinkan: Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, serta GPTBot dan
Google-Extended. Diblokir: CCBot. Ubah daftar `ALLOWED_BOTS` di `src/seo/files.ts`.
Jalur privat (`/api/`, `/auth/`, `/uploads/`, `/checkout`, `/dashboard`, `/login`) tidak boleh di-crawl.

## Setelah domain aktif

1. Set `SITE_URL=https://<domain>` pada build produksi, build ulang, deploy.
2. Cek `https://<domain>/robots.txt` (tanpa `Disallow: /` untuk `*`) dan `/sitemap.xml`.
3. Daftarkan domain di Google Search Console (verifikasi DNS TXT), submit `sitemap.xml`.
4. Hubungkan GA4/PostHog bila perlu; tidak ada tracking yang diubah oleh paket ini.
5. Atur redirect `www` ke non-www (atau sebaliknya) di hosting (Firebase Hosting: tambah domain custom,
   pilih "Redirect to"); canonical selalu mengarah ke `SITE_URL`.

## Catatan

- Rewrite `**` -> `/index.html` di `firebase.json` membuat URL yang tidak ada tetap dijawab 200 (soft 404).
  `404.html` sudah dibuat tetapi baru terpakai bila rewrite itu dipersempit ke rute yang dikenal.
- Mengubah isi halaman: perbarui `LAST_UPDATED` di `content.ts`.
- Build gagal mengambil katalog harga: tabel harga, `pricing.md`, dan Offer JSON-LD tidak berisi harga
  (ada TODO), bukan angka karangan. Build tetap lulus dengan peringatan.
