# Platform Dashboard — Design

Date: 2026-10-31 · Branch: `feature/platform-dashboard` · Audience: platform admins only.

## Goal

One page at `/platform/dashboard` giving the SISKOP owner a view of how the SaaS itself is doing:

1. Performance of SISKOP (activity + technical)
2. Growth of new users and new koperasi
3. Growth of members in the system
4. Regional distribution of users
5. Items needing attention
6. Revenue growth

## Decisions (agreed with the user)

- **Approach C (hybrid).** Growth, revenue, region and activity are computed live from `createdAt` / `Invoice` / `User.lastLoginAt`, so history exists on day one. Only latency and error rate use a new aggregate table, because no such data exists today.
- **Region** comes from new nullable `Tenant.province` / `Tenant.city` columns. Tenants without a value fall in a "Belum diisi" bucket. No map in v1 (bar chart per province).
- **Performance** = both activity metrics and technical metrics (p50/p95 latency, 5xx rate). Technical series start empty and fill from deploy.
- **Revenue** = `Invoice` with status `PAID` (cash basis), grouped by paid month; MRR from active subscriptions (YEARLY ÷ 12). The revenue series is always the last 12 months, whatever the range filter.
- **User** = staff `User` rows; **anggota** = `Member` rows. Shown separately.

## Backend — `apps/backend/src/modules/platform-dashboard/`

- `routes.ts`, `service.ts`, `schema.ts` (+ one file per aggregator if `service.ts` grows).
- Mounted in `platformRoutes()` via `router.use("/dashboard", ...)`, inheriting `requireAuth` + `requirePlatformAdmin`.
- `GET /api/platform/dashboard?range=30d|90d|12m` → `ApiResponse<PlatformDashboard>`.
- `PlatformDashboard` is declared in `@siskop/types`. Money fields are decimal strings.

Response sections:

| Key | Content |
|-----|---------|
| `performance.activity` | active tenants 7d/30d (distinct tenants with a `User.lastLoginAt` in window), recorded actions per day (`AuditLog` rows) |
| `performance.technical` | per day: p50, p95, request count, 5xx rate |
| `growth` | new tenants and new users per bucket (day for 30d/90d, month for 12m) |
| `members` | cumulative `Member` count per bucket + total |
| `regions` | per province: tenants, users, members; plus "Belum diisi" |
| `attention[]` | `{ severity, kind, message, tenantId?, href? }` |
| `revenue` | paid total per month, MRR, delta vs previous period |

Attention rules: overdue invoices (`status = OPEN` and `dueDate` in the past; the enum has no OVERDUE); subscriptions `PAST_DUE`; subscriptions with `nextBillingDate` ≤ 7d; tenants with no login ≥ 30d; 5xx rate ≥ 5% over the last 24h (min 20 requests); tenants with no region. Quota-proximity alerts are deferred (see out of scope).

### Tenant isolation

These queries are intentionally cross-tenant. They run inside `withoutTenantScope` (`lib/tenant-scope.ts`), only behind `requirePlatformAdmin`. Tests assert a non-platform user gets 403.

## Schema (one migration)

- `Tenant.province String?` (Kemendagri 2-digit code), `Tenant.city String?` (free-text name). The static list of 38 provinces lives in `@siskop/types`.
- `RequestMetricHourly`: `hour DateTime`, `routeGroup String`, `count Int`, `errors5xx Int`, `p50Ms Int`, `p95Ms Int`; unique on `(hour, routeGroup)`. Platform-level, no `tenantId`.

## Request metrics

Middleware records duration + status per request into an in-memory buffer keyed by hour + Express route pattern (not raw URL). A timer flushes the buffer to `RequestMetricHourly`. Metrics never block or fail a request.

## Frontend

- `apps/frontend/src/pages/platform/PlatformDashboardPage.tsx`, lazy route in `App.tsx`, entry in `components/layout/nav.ts` (update `nav.test.ts`).
- KPI cards on top, then six Recharts panels (line: performance, growth, members; bar: revenue; horizontal bar: regions) and an attention list.
- Range filter in the header. Each panel has loading, empty and error states.
- Tenant create/edit form (and registration) gains province/city selects.

## Testing (TDD)

- Unit tests per aggregator with fixtures.
- Integration: 403 for tenant user, 200 shape for platform admin.
- Metrics middleware: buffering, flush, route grouping.
- Frontend: data-shaping helpers, as in `invoiceAdmin.test.ts`.
- Backend coverage stays ≥ 80%.

## Out of scope (v1)

GeoJSON map, email/push alerts, per-member region, report export, quota-proximity alerts.

## Risks

- Percentile storage: hourly p50/p95 can't be re-aggregated exactly across hours; the daily figure uses a count-weighted average of hourly values and is labelled approximate.
- Backend test DB migrations can lag; run migrate on `siskop_test` before the suite.
