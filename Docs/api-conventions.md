# API Conventions

## Response Envelope

**Success:**
```json
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "limit": 20, "total": 150 }
}
```
`meta` is omitted for non-paginated responses.

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "MEMBER_NOT_FOUND",
    "message": "Anggota dengan ID tersebut tidak ditemukan",
    "details": {}
  }
}
```
`details` is included for validation errors (field-level messages), omitted otherwise.

## Pagination

All list endpoints accept query params:
```
?page=1&limit=20&search=keyword&sortBy=createdAt&sortOrder=desc
```
Default: `page=1`, `limit=20`, `sortBy=createdAt`, `sortOrder=desc`.

## Currency

- Stored as `Decimal` in PostgreSQL (never `Float`)
- **API always returns monetary amounts as strings** to avoid JS float precision loss
- Example: `"1500000.00"` not `1500000`
- Frontend uses `formatRupiah()` from `packages/shared/utils` for display

## Error Codes

| Code                          | HTTP | Description                                      |
|-------------------------------|------|--------------------------------------------------|
| UNAUTHORIZED                  | 401  | Missing or invalid token                         |
| FORBIDDEN                     | 403  | Authenticated but insufficient role/permission   |
| NOT_FOUND                     | 404  | Generic resource not found                       |
| VALIDATION_ERROR              | 422  | Request body/params failed Zod validation        |
| TENANT_NOT_FOUND              | 404  | Subdomain does not map to a registered koperasi  |
| MEMBER_NOT_FOUND              | 404  | Member ID does not exist in tenant               |
| LOAN_NOT_FOUND                | 404  | Loan ID does not exist in tenant                 |
| MEMBER_HAS_NO_POKOK_SAVING    | 400  | Member not eligible — missing simpanan pokok     |
| MEMBER_HAS_EXISTING_LOAN      | 409  | Member already has an active loan (warn, not block) |
| PACKAGE_LIMIT_EXCEEDED        | 422  | Tenant's package does not allow creating another resource of this type (e.g. custom Simpanan config quota) |
| FEATURE_NOT_ENTITLED          | 403  | Tenant's package does not include this feature (e.g. whitelabel) |
| ROLE_IN_USE                   | 409  | Role cannot be deleted — still assigned to one or more users |
| ROLE_NOT_FOUND                | 404  | Role ID does not exist in tenant |
| NOTIFICATION_NOT_FOUND        | 404  | Notification ID does not exist |
| CANNOT_DEACTIVATE_SELF        | 400  | Platform admin cannot deactivate their own account |
| DOMAIN_ALREADY_USED           | 409  | Custom domain is already claimed by another tenant |
| ACCOUNT_CODE_INVALID_FORMAT   | 422  | Account code doesn't match the category-prefix convention for the given category (`1-` Aset, `2-` Kewajiban, `3-` Ekuitas, `4-` Pendapatan, `5-` Beban) |
| ACCOUNT_CODE_DUPLICATE        | 409  | Account code already exists for this tenant |
| ACCOUNT_IN_USE                | 409  | Account cannot be deleted/deactivated — it is `isDefault=true` or referenced by an `AccountMapping` |
| ACCOUNT_NOT_FOUND             | 404  | Account ID does not exist in tenant |
| MAPPING_ACCOUNT_CATEGORY_MISMATCH | 422 | Debit/credit account choice violates the expected normal-balance direction for the transaction kind |
| JOURNAL_ENTRY_UNBALANCED      | 500  | Internal guard rail — `SUM(debit) != SUM(credit)` detected before commit; should never actually reach a client |
| REPORT_PERIOD_INVALID         | 422  | `from`/`to` date range for a report is invalid (e.g. `from > to`) |
| SHU_DISTRIBUTION_PERCENT_INVALID | 422 | The 4 `ShuDistributionConfig` percentages (jasaSimpanan/jasaPinjaman/cadangan/lainnya) don't sum to exactly 100 |
| MODAL_DISETOR_INVALID         | 422  | `Tenant.modalDisetor` value is negative |

## Route Namespacing — Host (Platform Admin) additions

```
GET    /api/admin/notifications              List notifications (isRead computed per requesting platform admin)
GET    /api/admin/notifications/unread-count Unread count for the requesting platform admin
POST   /api/admin/notifications/:id/read     Mark one notification read
POST   /api/admin/notifications/read-all     Mark all notifications read

GET    /api/admin/users                      List platform admin users
POST   /api/admin/users                      Create a platform admin user
PUT    /api/admin/users/:id                  Update a platform admin user
DELETE /api/admin/users/:id                  Deactivate a platform admin user (soft delete)

POST   /api/admin/tenants/:id/logo           Upload/replace a tenant's logo (Host-managed)
```

## Route Namespacing — Konfigurasi Akun (Accounting Configuration) additions

Gated by the tenant's package entitlement (`"accounting"` in `SubscriptionPackage.modules[]`), else `403 FEATURE_NOT_ENTITLED`. See `Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md`.

```
GET    /api/config/accounts?category=&page=&limit=&search=      List accounts (paginated, filterable by category)
POST   /api/config/accounts                                     Create account
PUT    /api/config/accounts/:id                                 Update account (name/isActive; code immutable after creation)
DELETE /api/config/accounts/:id                                 Deactivate account (soft delete)
POST   /api/config/accounts/seed-default                        Seed the standard COA template — no-op/blocked if tenant already has accounts

GET    /api/config/account-mappings                             List mappings, joined with source config name + account names
PUT    /api/config/account-mappings                              Upsert one mapping (sourceType + sourceId + transactionKind + debit/credit account)
GET    /api/config/account-mappings/completeness                Count of expected vs. mapped transaction kinds (drives the UX completeness indicator)

POST   /api/config/accounts/:id/mark-cash-equivalent            Toggle Account.isCashEquivalent — drives the Kas/Bank grouping used by Laporan Arus Kas (§below)

GET    /api/config/shu-distribution                             Get the tenant's ShuDistributionConfig (null if not configured yet)
PUT    /api/config/shu-distribution                              Upsert ShuDistributionConfig — 4 percentages (jasaSimpanan/jasaPinjaman/cadangan/lainnya) must sum to 100

GET    /api/config/modal-disetor                                Get Tenant.modalDisetor + auditThresholdNotifiedAt (null if not set yet). NOT gated
                                                                  by "accounting" entitlement — general compliance field, only requirePermission('config', ...).
PUT    /api/config/modal-disetor                                Update Tenant.modalDisetor (body: { modalDisetor: number | null }); rejects negative
                                                                  values with 422 MODAL_DISETOR_INVALID. Drives the daily audit-threshold notification
                                                                  cron (Permenkop UKM No. 2/2024 Pasal 12, Rp5M) — see `apps/backend/src/lib/audit-threshold.ts`.
```

## Route Namespacing — Laporan Keuangan Regulasi (Neraca, Arus Kas) additions

Journal posting engine (`JournalEntry`/`JournalLine`, forward-only from transactions, no manual CRUD in v1) plus report generators derived from it. Gated the same as Konfigurasi Akun (`"accounting"` module entitlement) but under the existing `"reports"` permission key, not `"accounting"`. See `Docs/specs/2026-07-22-pelaporan-regulasi-design.md`.

```
GET    /api/reports/regulatory/neraca?asOfDate=       Neraca (balance sheet) as of a cutoff date (default: today). Self-checks
                                                       ASET = KEWAJIBAN + EKUITAS — current-period PENDAPATAN/BEBAN net income is
                                                       folded into EKUITAS as a computed "SHU Tahun Berjalan (Belum Ditutup)" line
                                                       since no P&L closing entry exists yet (that's Laporan Hasil Usaha, not built).
GET    /api/reports/regulatory/neraca/pdf?asOfDate=   PDF export of the above, `requirePermission('reports', 'export')` (same
                                                       gate as RPT-01/02's existing `/financial/pdf`, `/rat/pdf`).
GET    /api/reports/regulatory/arus-kas?from=&to=     Laporan Arus Kas (direct method), default period = current month. Groups
                                                       JournalLines touching Account.isCashEquivalent=true accounts into
                                                       Operasi/Investasi/Pendanaan. Returns `catatan` instead of aggregating if
                                                       the tenant hasn't marked any account as cash-equivalent yet.
GET    /api/reports/regulatory/arus-kas/pdf?from=&to= PDF export of the above (renders the `catatan` fallback as a plain notice
                                                       if no cash-equivalent account is marked yet).
GET    /api/reports/regulatory/laporan-hasil-usaha?from=&to=  PENDAPATAN − BEBAN for the period, default = current month. Does
                                                       NOT auto-post a closing JournalEntry to 3-3000 SHU Tahun Berjalan despite
                                                       the design spec's §6.2 prose — deliberately deferred (needs its own
                                                       idempotency/timing design); Neraca already accounts for unclosed income
                                                       via a computed line.
GET    /api/reports/regulatory/laporan-hasil-usaha/pdf?from=&to=  PDF export of the above.
GET    /api/reports/regulatory/shu-distribution?from=&to=     Daftar Pembagian SHU per Anggota. Allocates the period's SHU
                                                       across ShuDistributionConfig's 4 buckets, then divides jasaSimpanan/
                                                       jasaPinjaman proportionally per active member. Returns `catatan` instead
                                                       of an allocation if ShuDistributionConfig isn't set yet, or if the
                                                       period's SHU isn't positive.
GET    /api/reports/regulatory/shu-distribution/pdf?from=&to=  PDF export of the above (renders the `catatan` fallback as a
                                                       plain notice if config isn't set yet or the period's SHU isn't positive).
GET    /api/reports/regulatory/calk?from=&to=                CALK (Catatan Atas Laporan Keuangan). Numeric sections
                                                       (`rincianAset`/`rincianKewajiban`/`rincianEkuitas` with saldoAwal/
                                                       saldoAkhir/mutasi per account, `rincianPendapatan`/`rincianBeban`,
                                                       `shuBerjalan`) are re-derived on-demand from the existing Neraca (at
                                                       period start and end) and Laporan Hasil Usaha — no separate storage,
                                                       no new calculation logic. `narasi` returns the 4 fixed narrative
                                                       sections (`UMUM`/`DASAR_PENYUSUNAN`/`KEBIJAKAN_AKUNTANSI`/
                                                       `INFORMASI_TAMBAHAN`), each `{ content: string, updatedAt: string|null }`
                                                       — empty string / null if the tenant hasn't written that section yet.
PUT    /api/reports/regulatory/calk/narrative                Upsert one CALK narrative section (body: `{ section, content }`,
                                                       `section` one of the 4 above). Rich text is edited once by the tenant
                                                       and reused for every period's CALK — not stored per-period. Requires
                                                       `requirePermission('reports', 'update')` — the `reports` permission key
                                                       gained an `update` action for this (previously only `read`/`export`);
                                                       all default roles were re-seeded accordingly (Super Admin/Manager: true,
                                                       Teller/Viewer: false).
```

Not yet implemented (remaining Phase 3 roadmap items, see `docs/handoff.md`): LPEA (needs its own calculation spec). PDF export is done for Neraca/Arus Kas/Laporan Hasil Usaha/SHU-distribution above; CALK has no `/pdf` variant by design (§8 of the design spec) — its narrative sections are edited/reviewed in the UI, not exported as a static document.

## Route Namespacing

```
/api/auth/*       Auth routes (login, refresh, SSO callback — no authMiddleware)
/api/admin/*      Platform admin routes (isPlatformAdmin required, no tenantMiddleware)
/api/*            Tenant-scoped routes (dashboard, members, savings, loans, reports, config)
                   — pass through tenantMiddleware + authMiddleware. NOTE: there is no
                   `/api/tenant/` prefix; e.g. the members list is `GET /api/members`,
                   not `GET /api/tenant/members`.
```
