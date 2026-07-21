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
```

## Route Namespacing

```
/api/auth/*       Auth routes (login, refresh, SSO callback — no authMiddleware)
/api/admin/*      Platform admin routes (isPlatformAdmin required, no tenantMiddleware)
/api/*            Tenant-scoped routes (dashboard, members, savings, loans, reports, config)
                   — pass through tenantMiddleware + authMiddleware. NOTE: there is no
                   `/api/tenant/` prefix; e.g. the members list is `GET /api/members`,
                   not `GET /api/tenant/members`.
```
