# Backend — SISKOP

## App Entry & Middleware Order
All routes mounted in `src/app.ts`. Middleware order is fixed:
```
cors → helmet → rateLimit → tenantMiddleware → authMiddleware → routes
```

## Error Handling
Always throw `AppError` (from `src/lib/errors.ts`) — never call `res.status().json()` directly in route handlers.
Global error handler in `src/middleware/error.middleware.ts` formats all responses.

## Validation
Zod schemas in `src/modules/{module}/schemas.ts`. Validate request body/params before any business logic.

## Prisma
Import client from `src/lib/prisma.ts` (singleton). Never instantiate `new PrismaClient()` directly.
**IMPORTANT: Always include `tenantId` in queries on tenant-scoped models.**

## Business Logic Rules
- KOL: call `recalculateKOL(loanId)` from `src/lib/kol.ts` after every `LoanPayment` creation
- KOL daily recalculation: node-cron job at `00:05 WIB` in `src/jobs/kol-cron.ts`
- Member eligibility for loans: must have at least one active `SIMPANAN_POKOK` saving record
- ID generation: use `generateMemberId(tenantSlug)` and `generateAccountNumber()` from `src/lib/id-generator.ts`

## PDF Reports
Puppeteer in `src/lib/pdf.ts` with HTML templates in `src/templates/`.
PDF header must include: koperasi name, logo, address, registration ID.
PDF footer: koperasi name + page number.

## Email Notifications
Nodemailer via `src/lib/mailer.ts`. Templates in `src/templates/email/`.
Triggered for: overdue installment alerts, KOL escalation.

## Tests
```bash
pnpm jest   # from apps/backend/
```
