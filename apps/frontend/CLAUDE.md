# Frontend — SISKOP

## Routing
React Router v6. All route definitions in `src/App.tsx`.
Tenant routes render under `{slug}.siskop.com`; platform admin routes under `admin.siskop.com`.

## State Management
Zustand only — auth state in `src/stores/authStore.ts`, tenant info in `src/stores/tenantStore.ts`.
No Redux. No React Context for global state.

## Forms
react-hook-form + Zod validation on every form. No uncontrolled inputs.

## Charts
Recharts only. Do not introduce Chart.js or other chart libraries.

## UI Components
shadcn/ui components in `src/components/ui/`. Add new ones via:
```bash
npx shadcn@latest add <component>
```
Prefer existing shadcn components before building custom ones.

## Currency & Dates
- Currency: `formatRupiah(amount)` from `packages/shared/utils` → `Rp X.XXX.XXX`
- Dates: `formatTanggalIndonesia(date)` from `packages/shared/utils` → `DD MMMM YYYY`

## API & Auth
- All API calls via Axios instance in `src/lib/api.ts` (handles auth interceptors + token refresh)
- **IMPORTANT: Never store auth tokens in `localStorage` or `sessionStorage` — cookies only, managed by backend**

## Tests
```bash
pnpm vitest run   # from apps/frontend/
```
