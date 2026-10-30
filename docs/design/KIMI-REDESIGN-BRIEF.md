# SISKOP — UX Redesign Brief (for Kimi)

You are a senior product designer + front-end engineer. Redesign the **SISKOP web app** for a
markedly better user experience. This file is your full brief. Read all of it before producing anything.

---

## 1. Product in one paragraph

SISKOP (Sistem Informasi Koperasi) is a multi-tenant SaaS for **Indonesian cooperatives (koperasi)**.
Staff (admin, teller, accountant, manager) run daily work: members, savings (simpanan), loans (pinjaman),
shop/POS, market-cooperative collections, journals, regulatory reports. Members get a light self-service
portal. A separate **Platform Admin** area is for the SaaS vendor (tenants, packages, pricing, invoices).
**All UI copy is Bahasa Indonesia.** Keep it that way.

## 2. Who uses it (design for these people, in this order)

| Persona | Context | What they need |
|---|---|---|
| **Teller / admin koperasi** | Desktop, 6–8 h/day, small-town office, mid-range laptop, often slow internet. Not tech-savvy; age 30–55. | Fast repetitive entry: find member → post saving/loan payment → print receipt. Zero ambiguity. |
| **Manajer / pengurus** | Desktop + phone, checks numbers a few times a day. | Health at a glance: cash, NPL/KOL, overdue loans, growth. What needs my decision today? |
| **Akuntan / pengawas** | Desktop, dense data. | Journals, trial balance, regulatory statements (Neraca, Laba Rugi, Arus Kas, CALK, SHU). Keyboard-friendly, exportable. |
| **Kasir toko / Kolektor pasar** | Phone or tablet, standing, one hand, bright light. | POS and field-collection screens: big touch targets, minimal steps. |
| **Anggota (member)** | Phone only. | See balance, statement, loan status. |
| **Platform admin** | Desktop. | Tenants, packages, pricing matrix, invoices. Internal tool, density OK. |

## 3. Current UX problems to fix (observed in the code)

1. **Generic look.** Default shadcn "slate/zinc" theme, no brand identity; sidebar is hard-coded dark slate
   regardless of theme. Feels like an admin template, not a trusted financial product.
2. **Navigation is buried.** Sidebar groups (Laporan, Unit Usaha > KSP > Simpanan/Pinjaman…) are
   collapsed accordions, 3 levels deep. Users cannot see where things are. No global search, no
   command palette, no breadcrumbs, no recent items.
3. **Locked features are confusing.** Packages gate features (Pricing V2). Locked items link to
   `/langganan?fitur=…`; users do not understand why something is unavailable or what to do.
4. **Everything is a table or a tab strip.** List pages are plain `DataTable`s; Config and Reports are
   many-tab pages. Little hierarchy, no saved filters, weak empty/loading/error states.
5. **Dashboard shows numbers, not decisions.** Stat cards without "what should I do next".
6. **Money entry is error-prone.** Amounts typed in plain inputs; no thousand-separator live formatting,
   no confirm summary before posting, weak undo/receipt flow.
7. **Mobile is an afterthought.** Fixed `p-6` shell, desktop tables on phones. Kasir/Kolektor/member screens
   need true mobile-first layouts.
8. **Accounting jargon without help.** Terms like KOL, BMPP, SHU, CALK, Modal Sendiri, Unposted Journal
   appear with no inline explanation.
9. **Inconsistent feedback.** Toasts, banners and inline errors are mixed; destructive actions
   (void, close year / Tutup Buku) lack stronger, consistent confirmation patterns.
10. **Accessibility gaps.** Low contrast in muted text, icon-only buttons without labels, focus rings
    inconsistent. Must meet **WCAG 2.2 AA**.

## 4. Goals & success measures

- A teller completes "setor simpanan" (find member → deposit → receipt) in **≤ 4 interactions / < 30 s**.
- Manager sees "what needs attention" within **one screen, no scroll** on a 1366×768 laptop.
- Any page reachable in **≤ 2 clicks or one keystroke** (command palette `Ctrl/⌘+K`).
- Every screen has designed **loading, empty, error, locked (not in package), and read-only** states.
- Works at 360 px width through 1920 px. Touch targets ≥ 44 px on mobile.
- Light and dark theme. Respect `prefers-reduced-motion`.
- Per-tenant **white-label**: logo + one primary brand color must restyle the app without breaking contrast.

## 5. Brand direction

- Existing marketing site (landing) uses: forest `#071b16`, mint-white `#eff9ef`, muted mint `#b0c8bd`,
  lime `#d0fa88`, rule `#284b3d`; font **Manrope**; Lucide icons (1.5–2 px stroke); linked-rings logo mark.
  See `docs/landing-page/design.md` and the concept PNGs in `docs/landing-page/`.
- The **app** should feel like the same family but **calmer and more functional** than the landing page:
  trustworthy, clear, a little warm (this is people's savings). Not crypto-neon, not bank-corporate-grey.
- You may propose a refined palette. Constraints: AA contrast for all text, semantic colors
  (success / warning / danger / info) that are distinguishable without color alone, and a themable primary.
- Typography: Manrope (already bundled) or propose one alternative. Tabular numerals for all money.

## 6. Hard constraints (do not violate)

- **Stack must stay:** React 18, TypeScript, Vite, Tailwind CSS 3.4, shadcn/ui on Radix primitives,
  `lucide-react`, `react-hook-form` + `zod`, `@tanstack/react-query`, `recharts`, `zustand`,
  `react-router-dom` v6. **Do not introduce another UI framework** (no MUI, Chakra, Ant).
- **Theming via CSS variables** in HSL, same token names shadcn uses (`--background`, `--foreground`,
  `--primary`, `--card`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring`, `--radius`,
  `--sidebar-*`) — extend with `--success`, `--warning`, `--info` if needed. Tailwind maps them in
  `apps/frontend/tailwind.config.js`; tokens live in `apps/frontend/src/index.css`.
- **Money:** display as `Rp 1.250.000` (Indonesian grouping, no decimals unless needed), right-aligned,
  `font-variant-numeric: tabular-nums`. Negative = minus sign + color + (optionally) parentheses in
  accounting views — never color alone.
- **Dates:** Indonesian locale, `dd MMM yyyy`, timezone Asia/Jakarta.
- **Multi-unit model:** a tenant has ≥ 1 *unit usaha*. Never design around a "KSU vs KSP" type switch.
  Multi-unit UI (unit filter, consolidated view) appears **only when the tenant has more than one unit**.
- **Permissions & packages are dynamic.** Menus/actions appear per role permission; features may be
  *locked* by package. Design a single consistent **locked state** (see §8).
- **Do not invent data, metrics, or features** that the app doesn't have. Use realistic Indonesian
  placeholder data (e.g. "Koperasi Barokah", "Budi Santoso", `Rp 2.500.000`).
- Keep the **API envelope** and logic untouched — this is a presentation-layer redesign.

## 7. Information architecture to redesign

Current sitemap (routes in `apps/frontend/src/App.tsx`):

```
Public      /  (landing)  /login  /daftar/:tenantSlug (member self-registration via QR)  /invite
Core        /dashboard
            /members  /members/new  /members/:id  /members/:id/edit  (+ tab: permintaan pendaftaran)
            /savings  /savings/new  /savings/:id   (statement = "Rekening Koran")
            /loans    /loans/new    /loans/:id     /loans/overdue
            /piutang  (Piutang Anggota / member credit)
            /expenses (Beban Umum)
Reports     /reports (Keuangan)  /reports/regulatory  /reports/accounting (Buku Besar, Jurnal, Neraca Saldo)
            /reports/portfolio   /reports/pasar  /journal/new (Jurnal Manual)  /journal/close (Tutup Buku)
Unit Usaha  /ksu/units  /ksu/units/:id/{products,stock,pos,ppob,report}  /ksu/toko  /ksu/report (consolidated)
            /ksu/members/:id/statement   /market (Koperasi Pasar: stalls, sewa, retribusi, kolektor)
Config      /config  tabs: Unit, Peran, Pengguna, COA, Pemetaan Akun, Simpanan, Pinjaman, SHU,
            Modal Disetor, Kalender Operasional, Pendaftaran Mandiri, Whitelabel, Jejak Audit
Billing     /langganan (subscription, usage vs quota, invoices)   /profile
Platform    /platform/{tenants,packages,pricing,invoices,admins}   (super-admin only)
```

**Task:** propose a better IA. Ideas to evaluate (justify what you keep or drop):
- Task-oriented top groups (Harian · Anggota · Keuangan · Laporan · Pengaturan) instead of module names.
- Collapsible icon-rail sidebar; pinned/favorite items; "Terakhir dibuka".
- Global **command palette**: jump to page, search member by name/NIK/number, quick actions
  ("Setor simpanan", "Anggota baru", "Pinjaman baru").
- **Quick-action button** in the topbar for the 3–5 most frequent tasks per role.
- Breadcrumbs + page header pattern with primary action on the right.
- Contextual side panels / drawers for detail instead of full navigations where it speeds work.

## 8. Required cross-cutting patterns (design each explicitly)

1. **App shell** — sidebar (expanded/rail/mobile drawer), topbar (search, quick action, notification
   bell, unit switcher when multi-unit, user menu, theme toggle), content area with max-width rules.
2. **Page header** — title, description, breadcrumb, primary + secondary actions, tabs/segmented control.
3. **Data table** — sticky header, density toggle (comfortable/compact), column visibility, sort,
   filter chips, saved views, bulk actions, pagination, row → side drawer, responsive collapse to cards on mobile,
   tabular money columns, export menu (PDF/CSV).
4. **Forms** — sectioned, inline validation, `Rp` input with live grouping, date picker, member picker
   (async search by name/NIK), stepper for long flows (new loan), sticky footer with Save/Cancel,
   unsaved-changes guard, review-then-confirm summary for money-posting actions.
5. **Transaction receipt / success** — after a posting action: clear success state, receipt preview,
   Print / Share / "Transaksi berikutnya".
6. **Feedback system** — one hierarchy: inline field error → section alert → toast (non-blocking) →
   banner (system-wide, e.g. unposted journals, payment overdue) → blocking dialog (destructive).
7. **Destructive/irreversible actions** — Void, Tutup Buku, delete: typed-confirmation or two-step,
   with consequences stated in plain language.
8. **Locked-by-package state** — one reusable pattern: what it is, which package unlocks it, a single
   CTA "Lihat paket". Never a dead link. Also: quota meters ("Anggota 180/200") with warn/limit states.
9. **Empty / loading / error states** — skeletons shaped like final content; empty states that teach
   the next action; error states with retry and a human explanation (no stack traces).
10. **Glossary tooltips** — dotted-underline term → popover with a one-sentence plain-Indonesian
    definition (KOL, NPL, SHU, CALK, BMPP, Modal Sendiri, Simpanan Pokok/Wajib/Sukarela…).
11. **Charts** — Recharts-compatible spec: palette safe for color-blindness, direct labels over legends
    where possible, accessible table fallback, consistent tooltip.
12. **Notifications** — bell with grouped, actionable items (e.g. new member registration → approve/reject).

## 9. Screens to design in full (high-fidelity, desktop + mobile)

Priority 1 (do these first, at full detail):
1. **Login / central tenant selection** (staff picks koperasi; member login by NIK).
2. **Dashboard (manager)** — "Perlu perhatian hari ini" (overdue loans, pending registrations, unposted
   journals, payment standing), cash & liquidity, KOL/NPL health, savings & loan trend, quick actions.
3. **Members list + Member detail** (profile, savings accounts, loans, credit, documents, timeline).
4. **Setor / tarik simpanan** flow end to end, including receipt.
5. **New loan** (multi-step: member → product/terms → schedule preview → review → submit) and **Loan detail**
   (schedule, payment posting, status timeline, KOL badge).
6. **POS (kasir)** — mobile/tablet-first.
7. **Subscription & package page** — usage vs quota, locked-feature explanation, invoices, upgrade.

Priority 2 (design at medium detail, reusing the system):
8. Reports hub + one financial statement (Neraca) + Rekening Koran statement + print layout.
9. Jurnal Manual + Tutup Buku (high-risk flow).
10. Config hub (replace the 13-tab strip with a navigable settings layout).
11. Koperasi Pasar: Kolektor mobile screen (collect → verify batch), stall list.
12. Member self-registration public form (mobile, KTP upload) + staff review queue.
13. Member portal home (mobile): balance, last transactions, loan status.

Priority 3 (apply the system, list differences only):
14. Platform admin: tenants, pricing matrix, invoices.

## 10. Deliverables (produce all)

1. **`DESIGN-SYSTEM.md`** — principles, color tokens (light + dark, HSL values for every CSS variable
   listed in §6, plus semantic extras), type scale, spacing/radius/shadow/elevation, iconography rules,
   motion rules, density modes, breakpoints, z-index scale.
2. **`tokens.css`** — drop-in replacement for the `:root` / `.dark` blocks in `apps/frontend/src/index.css`
   and an updated `tailwind.config.js` `theme.extend` snippet.
3. **Component specs** — for each: anatomy, variants, states (default/hover/focus/active/disabled/loading/
   error), sizes, a11y notes, and **shadcn/ui-compatible TSX** (using `cva`, `cn()`, Radix) for: Button,
   Input (+ `MoneyInput`), Select/Combobox (member picker), DataTable, PageHeader, StatCard, Badge/KOLBadge,
   Dialog/Drawer, Toast/Banner/Alert, EmptyState, LockedFeature, QuotaMeter, GlossaryTerm, Stepper,
   CommandPalette, Sidebar/Topbar.
4. **Screen designs** — for each screen in §9: layout description, component list, key states, and either
   (a) a working React+Tailwind implementation file, or (b) high-fidelity HTML. Desktop at 1366 and 1920,
   mobile at 360–390.
5. **User flows** — diagram or step list for the Priority 1 flows with the interaction count compared to today.
6. **Migration notes** — which existing files change (`components/layout/*`, `components/shared/*`,
   `components/ui/*`, page files), what can be done incrementally behind the same routes, and what is risky.
7. **A11y checklist** — contrast table for the final palette, keyboard map (incl. command palette and
   table navigation), focus order for the app shell, ARIA for tables/dialogs/toasts.

## 11. Output format rules

- Write Markdown for specs; code blocks tagged `tsx`, `css`, `html`.
- Code must be **TypeScript strict**, no `any`, functional components, named exports, Tailwind classes
  only (no inline style except dynamic values), no external fonts except Manrope.
- Import paths use the alias `@/` (= `apps/frontend/src/`). Reuse existing building blocks where sensible:
  `@/components/ui/*`, `@/components/shared/{DataTable,PageHeader,StatCard,ConfirmDialog,KOLBadge,QuotaBadge,
  NotEntitledNotice,EntitlementNotice,UnitFilter}`, `@/lib/utils` (`cn`).
- Give every non-obvious decision a one-line **rationale** tied to a persona or a problem in §3.
- Where two options are close, pick one and list the runner-up in one line. Don't hand back a menu.
- Flag assumptions explicitly under a final **"Assumptions & open questions"** heading.

## 12. Out of scope

Backend/API changes, new business features, new pricing/packages, native mobile apps, the marketing
landing page (already designed — only stay visually consistent with it), illustrations requiring
licensed assets. Do not rename domain terms (Simpanan, Pinjaman, Anggota, SHU, KOL…).

## 13. Reference files in this repo

| What | Where |
|---|---|
| Product requirements (authoritative) | `docs/01-PRD-SISKOP-v4.md` |
| Landing / brand tokens + concept art | `docs/landing-page/design.md`, `docs/landing-page/*.png` |
| Routes | `apps/frontend/src/App.tsx` |
| Shell & nav | `apps/frontend/src/components/layout/{AppLayout,Sidebar,Topbar}.tsx` |
| Shared components | `apps/frontend/src/components/shared/*`, `components/ui/*` |
| Theme tokens | `apps/frontend/src/index.css`, `apps/frontend/tailwind.config.js` |
| Pages | `apps/frontend/src/pages/**`, `apps/frontend/src/features/**` |
| Package/locking rules | `docs/package-modules/PRICING-V2-ROLLOUT.md` |
