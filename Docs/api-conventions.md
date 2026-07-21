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
| PACKAGE_LIMIT_EXCEEDED        | 422  | Tenant's package does not allow creating another resource of this type |
| FEATURE_NOT_ENTITLED          | 403  | Tenant's package does not include this feature (e.g. whitelabel) |

## Route Namespacing

```
/api/tenant/*     Tenant-scoped routes (pass through tenantMiddleware)
/api/admin/*      Platform admin routes (PLATFORM_ADMIN role required, no tenantMiddleware)
/api/auth/*       Auth routes (login, refresh, SSO callback — no authMiddleware)
```
