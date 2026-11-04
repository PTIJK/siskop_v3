# Referral partner program

Operations runbook for the referral (mitra) program: what the rules are, how to run it day to day, and the monthly payout cycle. Written for the platform owner and finance. Engineering detail is in the last section.

## What it is

External partners (agents, consultants, ex-Dinas Koperasi staff) recommend SISKOP. Each approved partner gets one code, `NEX-XXXXXX`. A koperasi that registers with the code is attributed to the partner for good, and the partner earns a percentage of what that koperasi pays for a fixed number of months.

- Default: **20% for 12 months**. Both numbers can be changed per partner and per referred koperasi.
- The commission base is the invoice **subtotal, before PPN and without the support fee**, of every **paid** invoice (registration, renewal, add-on). **The support fee never earns commission** (decided 2026-11-05).
- Partners have no login. They are records only, and everything is visible to platform admins only. Nothing about partners is exposed through tenant screens or tenant APIs.
- Commission is paid by manual bank transfer, tracked as a payout batch.

## Rules that are easy to get wrong

| Rule | What it means in practice |
|---|---|
| First code wins | Attribution is locked at registration. One partner per koperasi. |
| Terms are snapshotted | A koperasi keeps the rate and months it was signed at. Changing a partner's rate later affects only koperasi referred afterwards. |
| Commission window | A payment earns commission only if it is paid on or after attribution and before `attributedAt + months`. |
| Support fee is excluded | The yearly support fee is billed inside the registration and renewal invoices, so the system records it separately on each invoice (`supportAmount`) and pays commission on subtotal minus that amount. An invoice that is only the support fee earns nothing, and neither does an invoice of type SUPPORT. |
| Accrual is automatic | It happens in the same transaction that marks an invoice paid. Nothing to run by hand. |
| Never edit an amount | A wrong commission is fixed by **voiding** it with a reason. |
| Suspended partner | The code stops accepting new sign-ups. Commission on koperasi already referred keeps accruing unless you void it. |
| Self-referral | If a partner's email equals the koperasi's Super Admin email, the referral is **flagged**, not blocked. Check flagged rows on the partner page before paying. |
| 0% | Setting a koperasi's or partner's rate to 0% pauses commission without suspending anyone. |
| Limits | Rate 0–50%, months 1–60. Enforced by the server. |

## Menu map (platform admin)

| Screen | Path | Use |
|---|---|---|
| Mitra referral | `/platform/partners` | Applications tab (review queue), Partners tab, "Tambah mitra", "Pengaturan program" |
| Partner detail | `/platform/partners/:id` | KPIs, referred koperasi, commission ledger, payouts, statement download, edit |
| Pembayaran komisi | `/platform/payouts` | Create, pay and cancel payout batches |
| Koperasi, "Mitra" button | `/platform/tenants` | Attach or move a partner for a koperasi |
| Dashboard | `/platform/dashboard` | "Program mitra referral" card and a warning when applications are waiting |

Public pages: `/mitra` (program page) and `/mitra/daftar` (application form). Footer link "Jadi mitra".

## Day-to-day

### Reviewing an application

1. A pending application raises a warning on the dashboard and a count on the **Pendaftaran** tab. Target: review within 2×24 hours.
2. Open **Tinjau**. Check the name against the KTP number format, the bank account holder against the name, and the NPWP if given.
3. **Setujui & kirim kode** approves it, generates the code and emails the partner the code and a share link (`/register?ref=CODE`). You can set a vanity code (`NEX-BUDI`) and override rate and months here.
4. **Tolak** needs a reason, which is emailed to the applicant. They can re-apply after 30 days.

Duplicate applications (same email or WhatsApp number as an existing partner) are dropped silently by design, so the form cannot be used to find out who is a partner.

### Recruiting a partner offline

**Tambah mitra** creates an already-active partner and generates the code. Use it for people who signed on paper.

### Changing commission

| Level | Where | Applies to |
|---|---|---|
| Program default | Partners page, "Pengaturan program" | New partners only (it prefills the form) |
| One partner | Partner detail, "Ubah" | Koperasi that partner refers from now on |
| One koperasi | Partner detail, referred koperasi, "Ubah komisi" | That koperasi's invoices paid after the change |

Every change needs a reason and is written to the pricing audit log with who, when, and old → new. Commissions already accrued never change.

### A deal closed offline

On **Koperasi**, press **Mitra** on the row and pick the partner. Commission applies only to invoices paid **after** this. Choosing another partner later moves the koperasi, but commissions already earned stay with the partner who earned them.

### Voiding a commission

Partner detail, **Komisi** tab, **Batalkan**, with a reason. Only commissions still owed (status Terhutang) can be voided. If the commission is already in a draft payout, cancel the draft first. A paid commission cannot be voided here.

## Monthly payout cycle

Target: under one hour of admin time.

1. **Pick the cutoff.** Usually the last day of the previous month. The cutoff includes the whole day, Jakarta time.
2. **Create drafts.** `/platform/payouts`, **Buat pembayaran**. The partner list shows only partners with an outstanding balance. Repeat per partner. Each draft gets a number `PO-YYYYMM-NNNN` and locks its commissions, so two drafts can never take the same commission.
3. **Check.** Open the partner page for any partner with a flagged self-referral or a large amount. Cancel a draft if something is wrong. Cancelling returns its commissions to owed.
4. **Download statements.** Partner detail, **Unduh statement CSV**, for the period. Send it to the partner by email or WhatsApp. The CSV opens in Excel and lists each commission with its payout number.
5. **Transfer.** Pay the net amount to the bank account on the partner record.
6. **Record it.** On the draft press **Tandai dibayar** and enter the transfer reference, the transfer date, and any tax withheld. The net amount is gross minus tax. The commissions become Dibayar and the partner's outstanding balance drops.

A paid payout cannot be cancelled or edited. If it was recorded wrongly, raise it with engineering rather than working around it.

### Tax

The system stores the withheld amount per payout and does not calculate it. Whether the partner is treated as an individual (PPh 21) or a business (PPh 23), and at what rate, is a finance decision (see open items). Enter the amount actually withheld.

## Checks before launch and after the first cycle

- A registration with a valid code creates a referral. An unknown, pending, rejected or suspended code is refused with a message and the field can be cleared.
- Marking a referred koperasi's invoice paid creates exactly one commission, at 20% of the subtotal. Marking it again creates none.
- A renewal paid after the window ends earns nothing.
- Tenant users get 403 on every `/api/platform/partners*`, `/payouts*`, `/referrals*`, `/commissions*` and `/referral-settings` route.
- Pilot success: at least 5 active partners, at least 10 referred registrations, every referred paid invoice has exactly one commission, and the first payout cycle takes under an hour.

## Open policy items

These are product decisions, not code. The defaults in force are noted.

- **PPh treatment** (21 vs 23, rate). Currently manual.
- **Partner terms text.** The wording on `/mitra` and the version stamp `PARTNER_TERMS_VERSION` in `apps/frontend/src/features/onboarding/partner.ts` need legal sign-off. Bump the version whenever the terms change.
- **Retention of personal data.** The form collects KTP and bank details. A retention period for rejected applications (proposed 12 months) is not yet enforced by any job.

## Support fee and invoices that already exist

Invoices created before 2026-11-05 have no support amount recorded (it defaults to 0). That does not matter for the launch, because nobody has been referred yet. It does matter in one case: if you attach a partner to an **existing** koperasi that already has an **open** invoice with a support fee inside it, that invoice will pay commission on the support part too. Before attaching a partner to such a koperasi, either void and reissue the open invoice or void the commission it earns.

## Engineering notes

- Tables: `ReferralPartner`, `TenantReferral`, `ReferralCommission`, `ReferralPayout`, plus `PricingSetting.referralDefaultRate` and `referralDefaultMonths`. Money is `Decimal`, rates are fractions (`0.2000` = 20%).
- Accrual: `lib/referrals/accrue.ts`, called from `confirmPayment` inside its transaction. It is a no-op when the koperasi has no referral.
- Modules: `modules/referrals/` (applications, review, admin, payouts), `lib/referrals/` (codes, accrual, attribution, emails), `modules/platform-dashboard/referrals.ts` (dashboard totals).
- These are platform tables with no `tenantId` scoping. Every query on them runs under `withoutTenantScope()`, and none are reachable from tenant routes.
- Foreign keys from commissions to tenants, invoices and payments are `Restrict`, so financial history survives. Any test or cleanup that deletes tenants or invoices must delete commissions first.
- Public endpoints: `GET /api/onboarding/referral/:code` (returns only validity and display name) and `POST /api/partners/apply`. Both are rate limited, and the apply route also has an origin check and a honeypot field.
- Audit: entities `referral_partner`, `tenant_referral`, `referral_commission`, `referral_payout`, `referral_settings` in `PricingAuditLog`.
- Emails (received, approved, rejected) go through Resend after commit and never block the action. Without `RESEND_API_KEY` they are skipped with a warning.
