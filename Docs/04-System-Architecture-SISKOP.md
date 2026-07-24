# System Architecture Document
## SISKOP — Sistem Informasi Koperasi Berbasis SaaS

| | |
|---|---|
| **Versi** | 1.1.0 |
| **Tanggal** | 22 Juli 2026 |
| **Status** | Draft |

---

## 1. Architecture Overview

SISKOP menggunakan arsitektur **monorepo multi-tenant** dengan pendekatan subdomain-based tenancy. Setiap koperasi (tenant) mendapatkan subdomain eksklusif dengan data yang sepenuhnya terisolasi.

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
└──────────────┬──────────────────────────┬───────────────────────┘
               │                          │
   ┌───────────▼──────────┐  ┌────────────▼──────────────┐
   │  {slug}.siskop.com   │  │    admin.siskop.com        │
   │  (Tenant Portal)     │  │    (Platform Admin)        │
   └───────────┬──────────┘  └────────────┬──────────────┘
               │                          │
   ┌───────────▼──────────────────────────▼──────────────┐
   │              NGINX Reverse Proxy                     │
   │          (Wildcard SSL, Subdomain Routing)           │
   └───────────┬──────────────────────────┬──────────────┘
               │                          │
   ┌───────────▼──────────┐  ┌────────────▼──────────────┐
   │   React Frontend     │  │   Node.js/Express API      │
   │   (Vite, port 5173)  │  │   (TypeScript, port 3000)  │
   └──────────────────────┘  └────────────┬──────────────┘
                                          │
                             ┌────────────▼──────────────┐
                             │      PostgreSQL DB         │
                             │   (Multi-tenant, row-level)│
                             └───────────────────────────┘
```

---

## 2. Tech Stack

### 2.1 Frontend
| Layer | Teknologi | Versi | Alasan |
|-------|-----------|-------|--------|
| Framework | React | 18.x | Component-based, ekosistem luas |
| Build Tool | Vite | 5.x | Fast HMR, optimized builds |
| Language | TypeScript | 5.x | Type safety, developer experience |
| Styling | Tailwind CSS | 3.x | Utility-first, konsisten |
| UI Components | shadcn/ui | latest | Accessible, customizable |
| State Management | Zustand | 4.x | Ringan, minimal boilerplate |
| Routing | React Router | 6.x | Nested routes, loader support |
| HTTP Client | Axios | 1.x | Interceptors, error handling |
| Forms | React Hook Form + Zod | 7.x + 3.x | Performant, schema validation |
| Charts | Recharts | 2.x | React-native charts |
| Testing | Vitest | 1.x | Vite-native, Jest compatible |

### 2.2 Backend
| Layer | Teknologi | Versi | Alasan |
|-------|-----------|-------|--------|
| Runtime | Node.js | 20.x LTS | Stable, LTS support |
| Framework | Express | 4.x | Mature, flexible middleware |
| Language | TypeScript | 5.x | Type safety |
| ORM | Prisma | 5.x | Type-safe DB client, migrations |
| Database | PostgreSQL | 16.x | ACID, JSONB support, Decimal |
| Auth | JWT + bcrypt | - | Stateless auth, secure passwords |
| OAuth | Passport.js | 0.7.x | Google SSO |
| File Upload | Multer | 1.x | Multipart form handling |
| PDF | Puppeteer | 22.x | HTML → PDF rendering |
| Scheduler | node-cron | 3.x | KOL recalculation harian |
| Validation | Zod | 3.x | Schema validation |
| Rate Limiting | express-rate-limit | 7.x | Brute force protection |
| Testing | Jest + Supertest | 29.x | Integration & unit tests |

### 2.3 Infrastructure (Development)
| Komponen | Teknologi |
|----------|-----------|
| Local DB | Docker (PostgreSQL container) |
| Package Manager | pnpm (workspace) |
| Process Manager | nodemon (dev), PM2 (prod) |
| Reverse Proxy | Nginx |

---

## 3. Monorepo Structure

```
siskop/
├── apps/
│   ├── frontend/                    # React + Vite SPA
│   │   ├── src/
│   │   │   ├── pages/               # Route-level components
│   │   │   │   ├── auth/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── members/
│   │   │   │   ├── savings/
│   │   │   │   ├── loans/
│   │   │   │   ├── reports/
│   │   │   │   ├── config/
│   │   │   │   └── admin/
│   │   │   ├── components/
│   │   │   │   ├── ui/              # shadcn/ui components
│   │   │   │   ├── layout/          # AppLayout, Sidebar, Topbar
│   │   │   │   └── shared/          # DataTable, StatCard, etc.
│   │   │   ├── hooks/               # Custom React hooks
│   │   │   ├── stores/              # Zustand stores
│   │   │   ├── lib/
│   │   │   │   ├── api.ts           # Axios instance + interceptors
│   │   │   │   └── utils.ts
│   │   │   ├── App.tsx              # Router setup
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── backend/                     # Node.js + Express API
│       ├── src/
│       │   ├── app.ts               # Express app + middleware setup
│       │   ├── server.ts            # Entry point, port binding
│       │   ├── middleware/
│       │   │   ├── auth.middleware.ts
│       │   │   ├── tenant.middleware.ts
│       │   │   ├── rbac.middleware.ts
│       │   │   └── error.middleware.ts
│       │   ├── modules/             # Feature modules
│       │   │   ├── auth/
│       │   │   │   ├── auth.router.ts
│       │   │   │   ├── auth.service.ts
│       │   │   │   ├── auth.controller.ts
│       │   │   │   └── auth.schema.ts
│       │   │   ├── members/
│       │   │   ├── savings/
│       │   │   ├── loans/
│       │   │   ├── reports/         # RPT-01/02 + regulatory-reports.* (Neraca, Arus Kas, dst.)
│       │   │   ├── config/          # profile/users/roles + coa.* (Konfigurasi Akun), shu-distribution.*, modal-disetor.*
│       │   │   └── admin/
│       │   ├── lib/
│       │   │   ├── prisma.ts        # Prisma singleton
│       │   │   ├── jwt.ts           # Token generation/verification
│       │   │   ├── id-generator.ts  # memberId & accountNumber
│       │   │   ├── kol.ts           # KOL recalculation logic
│       │   │   ├── loan-calc.ts     # Angsuran calculator
│       │   │   ├── pdf.ts           # Puppeteer PDF generator
│       │   │   ├── audit-threshold.ts # Cek Tenant.modalDisetor vs. ambang wajib-audit (§8.3)
│       │   │   └── scheduler.ts     # node-cron jobs
│       │   └── templates/           # HTML templates untuk PDF
│       ├── tests/
│       └── package.json
│
├── packages/
│   └── shared/                      # Shared types & utilities
│       ├── src/
│       │   ├── types/               # TypeScript interfaces
│       │   └── utils/               # formatRupiah, formatTanggal, etc.
│       └── package.json
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
│
├── docker-compose.yml               # Local PostgreSQL
├── Makefile                         # Developer commands
├── CLAUDE.md                        # Claude Code memory
├── .env.example
└── package.json                     # Root workspace config
```

---

## 4. Multi-Tenancy Architecture

### 4.1 Subdomain-Based Tenant Resolution

```
Request: GET https://kopsejahtera.siskop.com/api/members

┌─────────────────────────────────────┐
│ 1. Nginx terima request             │
│    - Wildcard SSL: *.siskop.com     │
│    - Proxy ke backend port 3000     │
│    - Forward header: X-Host         │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│ 2. tenantMiddleware                 │
│    slug = req.hostname.split('.')[0]│
│    → "kopsejahtera"                 │
│    → prisma.tenant.findUnique({     │
│        where: { slug, isActive }    │
│      })                             │
│    → attach req.tenant              │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│ 3. authMiddleware                   │
│    - Verify JWT from httpOnly cookie│
│    - Confirm user.tenantId ===      │
│      req.tenant.id                  │
│    - Attach req.user                │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│ 4. Route Handler                    │
│    - SELALU filter by tenantId      │
│    - prisma.member.findMany({       │
│        where: { tenantId:           │
│          req.tenant.id }            │
│      })                             │
└─────────────────────────────────────┘
```

### 4.2 Data Isolation

- **Row-level isolation:** setiap tabel data memiliki kolom `tenantId`
- **No cross-tenant queries:** middleware memastikan semua query di-scope ke tenant aktif
- **Platform admin bypass:** route `/api/admin/*` skip tenant middleware, require `PLATFORM_ADMIN` role khusus

### 4.3 Platform Admin Separation

```
admin.siskop.com → adminMiddleware (bukan tenantMiddleware)
                 → Cek token PLATFORM_ADMIN
                 → Akses ke semua Tenant data
                 → Tidak terbatas ke satu tenant
```

---

## 5. Authentication Flow

### 5.1 Standard Login

```
┌──────────┐    POST /api/auth/login     ┌──────────────┐
│ Frontend │ ─────────────────────────► │   Backend    │
│          │   { email, password }       │              │
│          │                             │ 1. Get tenant│
│          │                             │    by slug   │
│          │                             │ 2. Find user │
│          │                             │ 3. Verify pw │
│          │                             │ 4. Gen tokens│
│          │ ◄────────────────────────── │              │
│          │   Set-Cookie:               │              │
│          │   access_token (15m)        │              │
│          │   refresh_token (7d)        │              │
└──────────┘   httpOnly, Secure, SameSite=Strict       │
                                         └──────────────┘
```

### 5.2 Token Refresh Flow

```
Access token expired (401)
         │
         ▼
Frontend auto-retry via Axios interceptor
POST /api/auth/refresh (kirim refresh_token cookie)
         │
         ▼
Backend verify refresh_token
         │
    ┌────┴────┐
   valid    invalid/expired
    │            │
    ▼            ▼
New access   Clear cookies
token        Redirect /login
```

### 5.3 Google SSO Flow

```
User klik "Login Google"
    │
    ▼
GET /api/auth/google → Google Consent Screen
    │
    ▼ (callback)
GET /api/auth/google/callback
    │
    ▼
Cek email terdaftar di tenant
    │
  ┌─┴─┐
 ya   tidak
  │     │
  ▼     ▼
Login  Error: "Email tidak
normal  terdaftar di koperasi ini"
```

---

## 6. API Architecture

### 6.1 Middleware Stack (urutan wajib)

```typescript
// apps/backend/src/app.ts

app.use(helmet())                    // Security headers
app.use(cors(corsOptions))           // CORS dengan whitelist
app.use(express.json())             // Body parsing
app.use(rateLimiter)                 // Rate limiting global

// Routes
app.use('/api/auth', authRouter)               // Public (no auth)
app.use('/api/admin', adminMiddleware, adminRouter)  // Platform admin
app.use('/api', tenantMiddleware, authMiddleware, apiRouter) // Tenant routes
app.use(errorMiddleware)             // Global error handler (LAST)
```

### 6.2 Module Structure (Router-Controller-Service pattern)

```
modules/members/
├── members.router.ts      # Route definitions + RBAC middleware
├── members.controller.ts  # Request/response handling
├── members.service.ts     # Business logic
└── members.schema.ts      # Zod validation schemas
```

```typescript
// Pattern: Controller hanya handle HTTP, Service handle business logic

// Controller
async createMember(req: Request, res: Response) {
  const data = MemberCreateSchema.parse(req.body);
  const member = await memberService.create(req.tenant.id, data);
  res.status(201).json({ success: true, data: member });
}

// Service
async create(tenantId: string, data: MemberCreateInput): Promise<Member> {
  const memberId = await generateMemberId(tenantId);
  const accountNumber = await generateAccountNumber();
  return prisma.member.create({ data: { tenantId, memberId, accountNumber, ...data } });
}
```

### 6.3 Error Handling

```typescript
// lib/errors.ts
class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400,
    public details?: unknown
  ) { super(message); }
}

// Throw di service layer:
throw new AppError('MEMBER_NOT_FOUND', 'Anggota tidak ditemukan', 404);

// Global error middleware menangkap dan format response:
{ success: false, error: { code, message, details } }
```

---

## 7. Frontend Architecture

### 7.1 Routing & Auth Guard

```typescript
// App.tsx
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route element={<ProtectedRoute />}>         {/* Cek auth */}
    <Route element={<AppLayout />}>            {/* Sidebar + Topbar */}
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/members" element={
        <RequirePermission module="members" action="read">
          <MembersPage />
        </RequirePermission>
      } />
      {/* ... semua route terproteksi */}
    </Route>
  </Route>
</Routes>
```

### 7.2 API Client dengan Auto-Refresh

```typescript
// lib/api.ts
const api = axios.create({ baseURL: '/api', withCredentials: true });

// Response interceptor: handle 401 → auto refresh
api.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      await api.post('/auth/refresh');
      return api(error.config);
    }
    return Promise.reject(error);
  }
);
```

### 7.3 State Management (Zustand)

```typescript
// stores/authStore.ts
interface AuthStore {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  login: (user: User, tenant: Tenant) => void;
  logout: () => void;
}

// stores/tenantStore.ts
interface TenantStore {
  tenant: Tenant | null;
  setTenant: (tenant: Tenant) => void;
}
```

---

## 8. Scheduled Jobs

### 8.1 KOL Recalculation (Daily Cron)

```
Jadwal: Setiap hari pukul 00:05 WIB (Asia/Jakarta)
Cron:   "5 0 * * *"

Proses:
1. Ambil semua Loan dengan status ACTIVE
2. Per loan, hitung daysOverdue dari cicilan tertua yang belum dibayar
3. Tentukan KOLCategory berdasarkan threshold
4. Update Loan.kolCategory jika berbeda dari sebelumnya
5. Log jumlah loan yang di-update
```

### 8.2 Token Cleanup (Daily)

```
Jadwal: Setiap hari pukul 01:00 WIB
Cron:   "0 1 * * *"

Proses:
1. Delete semua RefreshToken dengan expiresAt < NOW()
```

### 8.3 Audit Threshold Check (Daily)

```
Jadwal: Setiap hari pukul 00:15 WIB (Asia/Jakarta)
Cron:   "15 17 * * *" (UTC)

Proses (apps/backend/src/lib/audit-threshold.ts):
1. Ambil semua Tenant dengan modalDisetor terisi
2. Bandingkan terhadap ambang wajib-audit Permenkop UKM No. 2/2024 Pasal 12 (Rp5M)
3. Jika terlampaui dan belum pernah dinotifikasi untuk kondisi ini:
   - Buat Notification bertipe AUDIT_THRESHOLD_EXCEEDED
   - Catat Tenant.auditThresholdNotifiedAt agar tidak berulang
```

Semua 3 cron job (KOL, billing, audit threshold) didaftarkan di `scheduler.ts` dan dijalankan berurutan tiap hari dengan jeda 5 menit (00:05, 00:10, 00:15 WIB) untuk menghindari beban query bersamaan.

---

## 9. Journal Posting Engine & Regulatory Reporting

Ditambahkan 22 Juli 2026 untuk memenuhi kewajiban pelaporan keuangan SAK EP (Permenkop UKM No. 2/2024) — Neraca, Laporan Arus Kas, Laporan Hasil Usaha, Daftar Pembagian SHU, dan CALK. Lihat `Docs/specs/2026-07-22-pelaporan-regulasi-design.md` untuk desain lengkap; `docs/02-FSD-SISKOP.md` §7.4/§8.3–8.6 untuk detail endpoint dan `docs/03-ERD-SISKOP.md` §2.13–2.18 untuk skema data.

### 9.1 Posting Flow

```
SavingTransaction / LoanPayment / Loan (disbursement)
    │
    ▼
regulatory-reports.service.ts → postJournalEntry(tenantId, sourceType, sourceId, ...)
    │
    ▼
Cari AccountMapping yang cocok:
  (tenantId, sourceType: SAVING_CONFIG|LOAN_CONFIG|SYSTEM, sourceId, transactionKind)
    │
  ┌─┴─────────────────────┐
 ditemukan          tidak ditemukan
  │                       │
  ▼                       ▼
Buat JournalEntry     Buat JournalEntry
status: POSTED        status: UNPOSTED_MISSING_MAPPING
  │                       │
  ▼                       ▼
Buat 2+ JournalLine    Tidak ikut dihitung laporan
(debit/kredit sesuai   sampai mapping dilengkapi
 AccountMapping)        dan entry di-reprocess
  │
  ▼
Guard rail: SUM(debit) === SUM(credit)
  → jika gagal: 500 JOURNAL_ENTRY_UNBALANCED (seharusnya tidak pernah terjadi)
```

Forward-only: tidak ada endpoint CRUD manual untuk `JournalEntry`/`JournalLine` di v1 — setiap baris jurnal berasal dari satu event transaksi yang sudah tervalidasi di modul sumbernya (savings/loans).

### 9.2 Report Generation (Aggregation, bukan Storage)

Tidak ada tabel saldo/ledger tersimpan terpisah. Setiap laporan regulasi mengagregasi `JournalLine` on-demand per request:

```
GET /api/reports/regulatory/neraca?asOfDate=2026-07-31
    │
    ▼
regulatory-reports.service.ts → getNeraca(tenantId, asOfDate)
    │
    ▼
SUM(JournalLine.debit - JournalLine.credit)
  GROUP BY Account.id
  WHERE JournalEntry.entryDate <= asOfDate
    │
    ▼
Kelompokkan per Account.category (ASET/KEWAJIBAN/EKUITAS/...)
Hitung SHU tahun berjalan (belum ditutup) dari PENDAPATAN − BEBAN periode berjalan
Self-check: ASET = KEWAJIBAN + EKUITAS (termasuk SHU belum ditutup)
    │
    ▼
Response JSON — atau PDF via generatePDF() (§10, sama seperti RPT-01/02)
```

Laporan Arus Kas mengikuti pola sama tapi memfilter `JournalLine` yang menyentuh `Account.isCashEquivalent = true`; CALK menurunkan bagian numeriknya dari dua panggilan `getNeraca()` (awal & akhir periode) plus `getLaporanHasilUsaha()` — tanpa kalkulasi baru.

---

## 10. PDF Generation Architecture

```
Frontend: GET /api/reports/financial/pdf?startDate=&endDate=
    │
    ▼
Backend Controller
    │
    ▼
reportService.generateFinancialReport(tenantId, params)
→ Ambil data dari DB
→ Format data
    │
    ▼
pdfService.generate(templateName, data, tenant)
→ Render HTML template (EJS/Handlebars)
→ Inject: logo URL, nama, alamat, no. reg koperasi
→ Inject: data laporan
    │
    ▼
Puppeteer
→ Launch headless Chromium
→ setContent(html)
→ pdf({ format: 'A4', printBackground: true })
    │
    ▼
Stream PDF ke response
Content-Type: application/pdf
Content-Disposition: attachment; filename="laporan-keuangan-juni-2026.pdf"
```

**Regulatory report templates (§9):** `generatePDF(tenantId, type, params)` di `regulatory-reports.service.ts` mengikuti pola identik — 4 renderer HTML module-level (`renderNeracaPdf`, `renderArusKasPdf`, `renderLaporanHasilUsahaPdf`, `renderShuDistributionPdf`) dibungkus `wrapRegulatoryPdf()`, memakai header/footer yang sama dengan RPT-01/02 (logo+nama+alamat+no. registrasi; footer nama+halaman). CALK tidak punya varian PDF (keputusan desain — lihat FSD §7.4).

---

## 11. Security Architecture

### 11.1 Authentication Security
- Password: bcrypt dengan cost factor 12
- JWT: signed dengan secret berbeda untuk access dan refresh token
- Cookies: httpOnly, Secure, SameSite=Strict
- Rate limiting login: max 10 request/menit per IP

### 11.2 Tenant Isolation
- Semua query data wajib include `tenantId` dari `req.tenant`
- Tidak ada endpoint yang bisa query lintas tenant (kecuali platform admin)
- User JWT payload berisi `tenantId` — divalidasi ulang saat setiap request

### 11.3 Input Validation
- Semua input divalidasi dengan Zod schema sebelum masuk service layer
- File upload dibatasi: type (jpg/png/pdf), size (max 2MB)
- SQL injection tidak mungkin karena menggunakan Prisma ORM (parameterized queries)

### 11.4 HTTP Security Headers (Helmet)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy` (configured for tenant subdomains)
- `Strict-Transport-Security`

---

## 12. Development Workflow

### 12.1 Makefile Commands

```makefile
# Setup
make install        # pnpm install semua workspace
make setup          # install + migrate + seed

# Development
make dev            # jalankan frontend + backend bersamaan
make dev-fe         # frontend only
make dev-be         # backend only

# Database
make migrate        # prisma migrate dev
make seed           # prisma db seed
make studio         # prisma studio (GUI)
make db-reset       # drop + migrate + seed ulang

# Testing
make test           # test semua workspace
make test-fe        # vitest frontend
make test-be        # jest backend

# Build
make build          # build semua
```

### 12.2 Environment Setup

```bash
# 1. Clone repo
git clone <repo>
cd siskop

# 2. Start PostgreSQL via Docker
docker-compose up -d

# 3. Setup environment
cp .env.example .env
# Edit .env sesuai kebutuhan

# 4. Install + migrate + seed
make setup

# 5. Jalankan development server
make dev
# → Frontend: http://localhost:5173
# → Backend:  http://localhost:3000

# 6. Akses via subdomain (tambahkan ke /etc/hosts untuk development):
# 127.0.0.1 demo.localhost
# Atau gunakan: http://localhost:5173 (frontend akan simulasi subdomain via env)
```

### 12.3 Seed Data (Development)

Setelah `make seed`, tersedia:

| Data | Value |
|------|-------|
| Tenant | `demo` (demo.siskop.com) |
| Admin | `admin@demo.com` / `Admin123!` |
| Role | SUPER_ADMIN, MANAGER, TELLER, VIEWER |
| Anggota | 10 anggota sample |
| Simpanan | Simpanan Pokok, Wajib, Sukarela (dengan rate) |
| Pinjaman | KUR Mikro, Pembiayaan Murabahah |

---

## 13. Deployment Architecture (Production)

```
                    ┌─────────────────────────────┐
                    │     DNS: *.siskop.com        │
                    │     Wildcard → Server IP     │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │     Nginx (Reverse Proxy)    │
                    │  - Wildcard SSL (Let's Enc.) │
                    │  - Proxy → localhost:3000    │
                    │  - Static files → dist/      │
                    └──────────────┬──────────────┘
                                   │
               ┌───────────────────┼──────────────────┐
               │                   │                   │
   ┌───────────▼──────┐  ┌────────▼────────┐  ┌──────▼──────────┐
   │ React Build      │  │ Node.js (PM2)   │  │ PostgreSQL       │
   │ (Static Files)   │  │ Express API     │  │ (Database)       │
   │ /var/www/siskop  │  │ Port 3000       │  │ Port 5432        │
   └──────────────────┘  └─────────────────┘  └─────────────────┘
```

**Catatan:** Dokumen ini menggambarkan arsitektur untuk deployment single-server (VPS). Untuk skala yang lebih besar, dapat dipertimbangkan pemisahan ke microservices atau penggunaan managed services (RDS untuk PostgreSQL, S3 untuk file storage, dll).
