# KSU Multi-Unit Spike — Week 1 Demo Walkthrough

Audience: CPO/CEO / non-engineer stakeholders. This is a 1-page summary of a
5-day engineering spike (branch `feature/ksu-mvp-week1-spike`), not a
description of a shipped feature.

## What this proves

A **KSU** (Koperasi Serba Usaha — a cooperative running more than one line of
business) is modeled in SISKOP as one tenant with **two or more
`CooperativeUnit`s**, not a special tenant "type." This spike demonstrates,
end-to-end against a real Postgres database and a real running backend:

1. **Loans can be routed to a specific unit.** Creating a loan now accepts an
   optional `unitId`; omitting it is byte-for-byte the original single-unit
   behavior, so nothing existing changes.
2. **Consolidated reporting across units.** `GET /api/ksu/consolidated` sums
   each unit's disbursed-loan assets and a tenant-wide total, derived from
   real journal entries — no new ledger, no separate data model.
3. **Per-member, per-unit SHU (Sisa Hasil Usaha) statements.** A member active
   in more than one unit gets their profit-sharing broken out by unit, reusing
   the exact same SHU formula and configuration the existing regulatory report
   uses — this spike does not invent a second calculation.
4. **A unit-level lending-concentration check.** Each KSP-type unit's active
   loan volume can be checked against a threshold (hardcoded at Rp
   5,000,000,000 for this spike) to flag when one unit is approaching or has
   exceeded it.
5. **Zero behavior change for existing single-unit tenants.** Verified two
   ways below — a code-diff check and a live smoke test.

## What this explicitly does NOT prove

- **Not a full Neraca (balance sheet) or Arus Kas (cash flow) per unit.** Only
  `GET /api/ksu/consolidated` exists, and it reports "assets attributable to
  loan disbursements," not a complete, audited balance sheet.
- **No Toko/POS (Konsumen) module.** The original spike plan paired a
  Simpan-Pinjam unit with a Toko unit; no POS/retail module exists anywhere in
  this codebase, so this demo uses **two KSP (Simpan Pinjam) units** instead,
  by explicit agreement with the project owner.
- **Savings cannot be split per unit yet.** Every `Saving` account always
  lands on the tenant's original ("default") unit — there is no unit-picker
  for savings, only for loans. A member's savings activity will always show up
  under their tenant's first unit, never a second one.
- **Only loan *disbursements* are attributed to a unit, not repayments.**
  `GET /api/ksu/consolidated` traces a journal entry back to a unit via the
  `Loan` it belongs to. That works for the disbursement entry (its `sourceId`
  is the loan itself), but a loan-payment or savings-transaction entry's
  `sourceId` points at the payment/transaction row, not the loan/saving — so
  ongoing repayments and savings deposits are invisible to this consolidation
  view. This is a documented limitation, not a bug.
- **The Rp 5B segregation threshold is an arbitrary placeholder**, not sourced
  from a specific regulation — chosen to prototype the UX, not to certify
  compliance.
- **The two new statement/segregation endpoints have no UI.** They exist only
  as HTTP APIs, added specifically so this walkthrough could show real
  responses without reading code.

## Seeding the demo data

```
pnpm --filter @siskop/backend db:seed:ksu-demo
```

This must be run with `DATABASE_URL` (and `JWT_SECRET`/`JWT_REFRESH_SECRET`)
explicitly pointed at the **`siskop_test`** database — a disposable database
on the same local Postgres container used by the automated test suite, e.g.:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/siskop_test" \
JWT_SECRET="test-secret" JWT_REFRESH_SECRET="test-refresh-secret" \
NODE_ENV="test" pnpm --filter @siskop/backend db:seed:ksu-demo
```

**Why `siskop_test` and not the real dev database:** the real local Postgres
instance also holds hand-curated demo/production-adjacent tenant data (real
bulk-imported cooperatives, credentials shown to stakeholders). Seeding this
spike's throwaway data into that same database would risk corrupting or
cluttering it; `siskop_test` is a completely separate, disposable database on
the same container, so this spike's data can never touch anything real.

The script creates exactly one new tenant and calls the same service-layer
functions the real HTTP routes call (not raw database inserts), so every
validation rule (duplicate account codes, "member needs a Simpanan Pokok
before a loan," tenant ownership, etc.) runs exactly as it would for a real
user.

## Demo tenant

| | |
|---|---|
| Tenant name | KSU Sejahtera Mandiri |
| Slug | `ksu-sejahtera-mandiri` |
| Admin email | `admin@ksu-sejahtera.demo` |
| Admin password | `KsuDemo123!` |
| Unit A | Simpan Pinjam Unit A — Rp 5,000,000 loan (Made Suryawan) + Rp 3,000,000 loan (Budi Setiawan) |
| Unit B | Simpan Pinjam Unit B — Rp 8,000,000 loan (Siti Rahmawati) |

Siti Rahmawati is the demo's "active in both units" member: her Simpanan Pokok
sits on Unit A (unavoidable — see the savings limitation above) while her loan
was explicitly disbursed to Unit B, so her per-unit SHU statement below shows
a real, non-zero split across both units.

## The three endpoints (real captured output)

All three require a bearer token from the tenant admin above and the same
accounting-entitlement + `reports:read` permission gate as the existing Neraca
report. Captured against a locally running backend pointed at `siskop_test`
(port 3099 was used in this session only because port 3001 was already
occupied by another process on this machine — the backend's default dev port
is 3001; substitute it if running standalone).

### 1. Consolidated assets across units

```
curl -s http://localhost:3099/api/ksu/consolidated \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": {
    "totalAssets": 16000000,
    "byUnit": [
      { "unitId": "cmtuyld120002kzpi1ljgj6zj", "unitName": "Simpan Pinjam Unit A", "assets": 8000000 },
      { "unitId": "cmtuyld2u000ekzpiih6l5v47", "unitName": "Simpan Pinjam Unit B", "assets": 8000000 }
    ]
  },
  "meta": { "timestamp": "2026-09-10T03:22:15.335Z", "requestId": "35b1ce75-648f-49e3-bcb8-bf0c1268896b" }
}
```

Unit A's Rp 8,000,000 is exactly Made's Rp 5,000,000 + Budi's Rp 3,000,000;
Unit B's Rp 8,000,000 is exactly Siti's loan — hand-verifiable.

### 2. Per-member, per-unit SHU statement

```
curl -s http://localhost:3099/api/ksu/members/cmtuylda6001akzpi57snq9bs/statement \
  -H "Authorization: Bearer $TOKEN"
```

(`cmtuylda6001akzpi57snq9bs` is Siti Rahmawati's member id, printed by the seed script.)

```json
{
  "success": true,
  "data": {
    "memberId": "cmtuylda6001akzpi57snq9bs",
    "units": [
      { "unitId": "cmtuyld120002kzpi1ljgj6zj", "unitName": "Simpan Pinjam Unit A", "shu": 11766.31 },
      { "unitId": "cmtuyld2u000ekzpiih6l5v47", "unitName": "Simpan Pinjam Unit B", "shu": 17649.46 }
    ]
  },
  "meta": { "timestamp": "2026-09-10T03:22:25.151Z", "requestId": "2d269a78-3cea-47eb-bb4c-1df025e4ef8e" }
}
```

### 3. Unit lending-concentration check

```
curl -s http://localhost:3099/api/ksu/units/cmtuyld120002kzpi1ljgj6zj/segregation \
  -H "Authorization: Bearer $TOKEN"
```

(`cmtuyld120002kzpi1ljgj6zj` is Unit A's id.)

```json
{
  "success": true,
  "data": {
    "unitId": "cmtuyld120002kzpi1ljgj6zj",
    "currentVolumeRp": 8000000,
    "thresholdRp": 5000000000,
    "status": "OK"
  },
  "meta": { "timestamp": "2026-09-10T03:22:33.863Z", "requestId": "8067abc6-59a3-4a61-898c-9193d86d7558" }
}
```

Rp 8,000,000 is nowhere near the Rp 5,000,000,000 threshold, hence `"OK"` —
the threshold-crossing behavior itself (`APPROACHING_THRESHOLD` at 90%,
`EXCEEDED` at 100%) is covered by an automated test with synthetic large
numbers, not re-demonstrated here with unrealistic demo data.

## Confirming nothing existing broke

Two checks, run for this spike, of different strength:

- **Code diff**: `git diff --stat` across all four KSU-spike commits
  (`4c46ee0..86f048c`) for `apps/backend/src/modules/reports/` touches exactly
  one file, `regulatory-service.ts`, and every change is additive (a new
  optional parameter with a backward-compatible default, plus one new
  exported function) — nothing existing was rewritten.
- **Live smoke test**: the pre-existing `GET /api/reports/financial` endpoint
  (the tenant's existing savings/loan summary report, unrelated to the new KSU
  endpoints) still returns a normal `200` for a freshly registered,
  ordinary single-unit tenant. This is a "nothing crashed" check, not a
  byte-for-byte comparison against a snapshot captured before this spike
  began — no such snapshot exists.

## Where to read the code

Branch `feature/ksu-mvp-week1-spike`, commits `6f754ed..HEAD` (starting from
the Day 1 regression test through this week's seed data, routes, and this
document).
