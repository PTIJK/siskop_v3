# KOL Category Rules (Kualitas Obligasi Pinjaman)

KOL is recalculated after every loan payment AND by a daily cron job (node-cron, runs at 00:05 WIB).

## Categories by Days Overdue

| Category         | Days Overdue | Action Required                              |
|------------------|--------------|----------------------------------------------|
| LANCAR           | 0–30 days    | None                                         |
| DALAM_PERHATIAN  | 31–90 days   | Flag for monitoring, notify manager via email |
| KURANG_LANCAR    | 91–120 days  | Restrict new loan applications               |
| DIRAGUKAN        | 121–180 days | Escalate to manager, email member contact    |
| MACET            | > 180 days   | Dashboard alert, restrict all transactions   |

Default thresholds follow OJK regulation. **All thresholds are configurable per tenant** in `SystemConfig.kolThresholds` (JSON field).

## Calculation Logic

```
daysOverdue = today - dueDate of oldest unpaid installment
```

A loan is LANCAR if either:
- All installments paid on time, OR
- Most recent payment was within 30 days of its due date

When a tenant customizes thresholds, the stored `kolThresholds` JSON overrides the defaults above.
Fallback to OJK defaults if `kolThresholds` is null.

## Display Rules

- **MACET** and **DIRAGUKAN** members appear in the dashboard alert section (`/loans` main page)
- Overdue members page (`/loans/overdue`) lists all non-LANCAR members sorted by severity (MACET first)
- KOL badge colors:
  - `LANCAR` → green
  - `DALAM_PERHATIAN` → yellow
  - `KURANG_LANCAR` → orange
  - `DIRAGUKAN` → red
  - `MACET` → dark red (`#7f1d1d`)

## Implementation

- Recalculation function: `src/lib/kol.ts` → `recalculateKOL(loanId: string)`
- Cron job: `src/jobs/kol-cron.ts` — iterates all active loans per tenant
- KOL value stored on `Loan.kolCategory` (enum) and `Loan.daysOverdue` (Int)
- Email notifications triggered when KOL transitions to DALAM_PERHATIAN or worse
