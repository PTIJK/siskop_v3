# Prompt Brief: Ilustrasi Sistem SISKOP
*Untuk digunakan di Gemini / ChatGPT (image generation) — berdasarkan PRD v1.4.0*

---

## Konteks Singkat (untuk referensi kamu, tidak perlu di-paste)

SISKOP adalah platform SaaS multi-tenant untuk Koperasi Simpan Pinjam (KSP) di Indonesia. Tiap koperasi punya subdomain sendiri (`{namakoperasi}.siskop.com`), data terisolasi, dan mendukung KSP konvensional maupun syariah. Ada 2 sisi sistem: **Platform Owner** (`admin.siskop.com`, mengelola semua koperasi) dan **Tenant/Koperasi** (Admin, Manajer, Teller, Viewer — mengelola anggota, simpanan, pinjaman, laporan).

Tiga ilustrasi di bawah menjelaskan sistem dari tiga sudut: **gambaran besar (hero)**, **arsitektur teknis**, dan **alur kerja bisnis**. Pilih salah satu atau buat ketiganya sesuai kebutuhan (dek penjualan, dokumentasi, onboarding).

---

## Style Guide Umum (berlaku untuk semua prompt di bawah)

Tambahkan baris ini ke prompt manapun yang kamu pilih, atau sesuaikan:

```
Style: modern flat vector illustration, clean corporate SaaS aesthetic,
soft rounded shapes, subtle drop shadows, isometric-friendly where noted.
Color palette: deep blue (#1E3A8A) and teal (#0D9488) as primary,
white/light gray background, amber (#F59E0B) as accent for alerts/highlights.
No photorealism, no literal screenshots, no dense paragraphs of text —
short labels only (2–4 words per label), in Bahasa Indonesia.
Aspect ratio: 16:9, high resolution, suitable for a slide deck.
```

---

## Ilustrasi 1 — Hero / Gambaran Besar Sistem

**Tujuan:** Slide pembuka / cover — menjelaskan "apa itu SISKOP" dalam satu gambar, untuk audiens non-teknis (calon pelanggan koperasi).

**Prompt:**
```
Create a flat vector illustration showing a cloud-based SaaS platform
called "SISKOP" at the center, connected by clean lines to 3-4 small
cooperative office buildings on one side (each labeled with a different
Indonesian subdomain badge, e.g. "koperasimaju.siskop.com"), and to a
single "admin.siskop.com" control panel icon on the other side supervising
all of them.

Inside each cooperative building icon, show small human silhouettes
representing a teller helping a member at a counter — one person handing
over a passbook/savings icon, another receiving a small coin/money icon
(representing simpanan/pinjaman transactions).

Add a subtle dashboard/chart icon floating above the central cloud to
represent real-time monitoring.

Style: modern flat vector illustration, clean corporate SaaS aesthetic,
soft rounded shapes, subtle drop shadows. Color palette: deep blue
(#1E3A8A) and teal (#0D9488) primary, white background, amber (#F59E0B)
accent. Minimal text labels in Bahasa Indonesia only where needed
("Koperasi", "Platform Owner", "SISKOP"). No photorealism.
Aspect ratio 16:9.
```

---

## Ilustrasi 2 — Arsitektur Sistem (Teknis)

**Tujuan:** Dokumentasi teknis / onboarding developer — menjelaskan alur request dari browser sampai database, sesuai `04-System-Architecture-SISKOP.md`.

**Prompt:**
```
Create a clean isometric or flat-layered system architecture diagram
with a top-to-bottom flow, 5 horizontal layers connected by vertical
arrows:

Layer 1 (top): Two browser/device icons labeled "Tenant Portal
({slug}.siskop.com)" and "Platform Admin (admin.siskop.com)"

Layer 2: A single gateway icon labeled "Reverse Proxy — Subdomain
Routing + SSL"

Layer 3: Two parallel boxes side by side — a React logo box labeled
"Frontend (React + Vite)" and a server icon labeled "API
(Node.js/Express)"

Layer 4: Small icon row under the API box showing three sub-modules as
small rounded tags: "Auth", "RBAC", "Multi-Tenant Middleware"

Layer 5 (bottom): A database cylinder icon labeled "PostgreSQL —
Multi-tenant, row-level isolation"

Use directional arrows flowing downward between each layer to show
request flow. Each layer should have a distinct but harmonious color
band (light blue, teal, indigo gradient top to bottom) so the diagram
reads as a clear technical stack at a glance.

Style: flat technical diagram illustration, minimal and precise like a
system design doc graphic, thin clean lines, sans-serif labels in
English/Bahasa Indonesia mixed as in the original terms. White
background. No people, no decorative elements — purely structural.
Aspect ratio 16:9.
```

---

## Ilustrasi 3 — Alur Kerja Inti (Bisnis Proses)

**Tujuan:** Menjelaskan siklus hidup anggota koperasi — dari pendaftaran sampai monitoring, untuk pelatihan staf/teller atau materi penjualan.

**Prompt:**
```
Create a horizontal flat-vector process flow illustration with 5 connected
stages, left to right, each stage as a rounded card icon linked by an
arrow:

Stage 1: "Registrasi Anggota" — icon of a person with an ID card/KTP
Stage 2: "Setor Simpanan" — icon of a hand depositing coins into a
piggy bank/passbook
Stage 3: "Pengajuan Pinjaman" — icon of a document with a checkmark and
a small cash/money bag
Stage 4: "Bayar Cicilan" — icon of a calendar with a recurring payment
arrow (looping icon)
Stage 5: "Monitoring KOL" — icon of a dashboard/traffic-light gauge
showing status levels from green to red (Lancar → Macet)

Under stage 5, add a small color-coded status ladder (green, yellow,
orange, red-orange, red) representing the 5 KOL categories, each with a
tiny label: "Lancar", "Dalam Perhatian", "Kurang Lancar", "Diragukan",
"Macet".

Style: modern flat vector illustration, friendly and approachable
(this is for staff training, not developers), rounded icons, soft
shadows. Color palette: deep blue and teal primary, amber/red accents
only on the KOL status ladder to show risk escalation. White background,
short Bahasa Indonesia labels under each stage. Aspect ratio 16:9.
```

---

## Tips Pemakaian

- Tempel satu prompt sekaligus (jangan gabung ketiganya) — hasil lebih presisi.
- Jika hasil pertama terlalu ramai teks, tambahkan: `"reduce text, use icons only"`.
- Untuk versi vertikal (Instagram/dokumen A4), ganti `Aspect ratio 16:9` → `Aspect ratio 4:5` atau `3:4`.
- Jika ingin gaya lebih playful/startup, ganti `corporate SaaS aesthetic` → `friendly startup illustration style, rounded mascot characters`.
