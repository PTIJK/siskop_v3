# Whitepaper: Claude 5 Model Capabilities & Applications for SISKOP

**Version:** 1.0
**Date:** 2026-07-26
**Author:** Research compiled by Claude (Claude Code), for the SISKOP V3 project
**Audience:** SISKOP product/engineering stakeholders evaluating AI-assisted features for the Koperasi Simpan Pinjam SaaS platform

---

## 1. Executive Summary

Anthropic's current model lineup — the **Claude 5 family** (Claude Fable 5, Claude Opus 5, Claude Sonnet 5) alongside **Claude Haiku 4.5** — represents a substantial capability jump over the models available when SISKOP's architecture docs were first drafted. The headline changes relevant to a multi-tenant financial SaaS like SISKOP are:

- **Adaptive thinking + effort control** replace fixed "thinking budgets," making cost/quality tuning simpler and more predictive.
- **1M-token context windows** (Opus 5, Sonnet 5, Fable 5) make it feasible to reason over an entire tenant's chart of accounts, a full loan portfolio, or months of transaction history in a single call.
- **Structured outputs** (`output_config.format` with JSON Schema) let a model return data that maps directly onto SISKOP's typed API envelope (`docs/api-conventions.md`) without brittle prompt-engineered JSON parsing.
- **Managed Agents** (hosted agent + sandbox) and the **Claude Agent SDK** open a path to autonomous, auditable back-office workflows (e.g., nightly KOL recalculation review, regulatory report drafting) without SISKOP hosting its own agent loop.
- **Prompt caching**, now with a **512-token minimum** on Opus 5, makes repeated-context workloads (e.g., "explain this tenant's Neraca" across many turns) materially cheaper.

This document summarizes the model lineup, the capabilities most relevant to SISKOP, and concrete, scoped feature ideas mapped to SISKOP's existing domain (koperasi simpan pinjam, syariah/konvensional, KOL categories, regulatory reporting). It closes with sequencing recommendations and open questions for the product owner.

---

## 2. Model Lineup (as of 2026-07-26)

| Model | Model ID | Context | Max Output | Input $/1M | Output $/1M | Positioning |
|---|---|---|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | 1M | 128K | $10.00 | $50.00 | Most capable widely released model; deepest reasoning, longest-horizon agentic work |
| Claude Opus 5 | `claude-opus-5` | 1M | 128K | $5.00 | $25.00 | Flagship for complex agentic coding & enterprise workloads; **recommended default** |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | 128K | $3.00 ($2.00 intro to 2026-08-31) | $15.00 ($10.00 intro) | Near-Opus quality on coding/agentic tasks at lower cost |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | 64K | $1.00 | $5.00 | Fastest, cheapest — high-volume/low-latency tasks |

**Note on "GPT-5" / other vendors:** this whitepaper covers Anthropic's Claude models only, since that is the model family already integrated into this development environment (Claude Code) and the one directly actionable for SISKOP without a new vendor integration.

### 2.1 Practical model selection for SISKOP

- **Sonnet 5** is the best default for most in-app, user-facing AI features (chat assistance, report narration, data extraction) — near-Opus quality at roughly half the cost, with the full `low`–`max` effort ladder.
- **Opus 5** is worth the extra cost for the hardest, highest-stakes tasks: end-to-end regulatory report drafting (CALK narrative), multi-step reasoning over KOL policy edge cases, or anything where a wrong answer has compliance consequences.
- **Haiku 4.5** fits high-volume, low-complexity tasks: classifying incoming support messages, extracting fields from a scanned KTP/ID, or generating short notification text.
- **Fable 5** is a specialty tool for the rare "give it your hardest unsolved problem" case (e.g., an autonomous audit-anomaly investigation across a full ledger) — not a default, given its pricing tier and elevated safety-classifier surface.

---

## 3. Capabilities Most Relevant to SISKOP

### 3.1 Adaptive thinking & effort levels

Every current model uses `thinking: {type: "adaptive"}` instead of a manually tuned token budget. A single `output_config.effort` parameter (`low` / `medium` / `high` / `xhigh` / `max`) now controls the depth-vs-cost tradeoff. For SISKOP this means:

- Routine tasks (e.g., "summarize this member's savings history in one paragraph") can run at `low`/`medium` for fast, cheap responses.
- Compliance-sensitive tasks (e.g., "check whether this loan's KOL classification is internally consistent with the tenant's custom thresholds") can run at `high`/`xhigh` without hand-tuning a token budget.

### 3.2 1M-token context windows

Opus 5, Sonnet 5, and Fable 5 default to a 1M-token context window. Practically, this means a single request can hold:

- A tenant's entire chart of accounts + account mappings (`Docs/specs/2026-07-21-konfigurasi-akun-coa-design.md`) for a coherent "explain my COA setup" assistant.
- A full period's journal entries for narrative generation in Laporan Hasil Usaha or CALK, instead of chunking and losing cross-period context.
- Months of a single member's savings/loan transaction history for a natural-language "why did my SHU change" explanation.

### 3.3 Structured outputs

`output_config.format` with a JSON Schema (or `client.messages.parse()`) constrains the model's response to a validated schema. This maps cleanly onto SISKOP's response envelope convention (`docs/api-conventions.md`) — e.g., a model-assisted "categorize this transaction" endpoint can return an object that's guaranteed to match the `SavingTransaction` or `LoanPayment` shape before it ever reaches Prisma, with `Decimal`-safe string amounts.

### 3.4 Tool use / function calling

Claude can call SISKOP's own backend functions as "tools" — e.g., a `lookup_member_by_id` or `get_loan_kol_history` tool — enabling an internal support/ops assistant that answers staff questions against live tenant data without SISKOP building a bespoke NLU layer. **Tenant isolation must still be enforced at the tool-implementation layer** — the model never bypasses `where: { tenantId }`; the tool function does.

### 3.5 Prompt caching

Repeated large context (a tenant's KOL threshold config, the CALK narrative sections, a long system prompt describing SISKOP's domain rules) can be cached, cutting cost by roughly 90% on cache hits. The Opus 5 minimum cacheable prefix dropped to 512 tokens (from 1024), so even moderately-sized tenant-specific context now qualifies.

### 3.6 Managed Agents & the Claude Agent SDK

Two distinct paths for autonomous work, both relevant to SISKOP's back-office needs:

- **Managed Agents** (Anthropic-hosted agent loop + sandboxed container): suited to a scheduled, auditable job — e.g., a nightly agent that reviews all loans flagged `DIRAGUKAN`/`MACET`, drafts a summary for the manager, and stops short of taking action (matching `docs/kol-categories.md`'s "notify manager" rule).
- **Claude Agent SDK**: for a SISKOP-hosted internal tool (e.g., a CLI or admin-panel assistant that can read/search the SISKOP codebase itself during development — which is effectively what this Claude Code session already is).

Both require careful scoping given SISKOP's tenant-isolation and soft-delete rules — any agent given write tools must be constrained to the same guardrails as the application code (no hard deletes, mandatory `tenantId` scoping).

### 3.7 Vision / document understanding

High-resolution vision (up to 2576px long edge on Opus 5/Sonnet 5) plus PDF support enables document-heavy koperasi workflows: reading a scanned KTP for member registration, extracting figures from a paper-based Neraca for migration, or verifying an uploaded payment proof image against a claimed transfer amount.

---

## 4. Candidate Features for SISKOP

The following are scoped ideas, roughly ordered by implementation effort and risk. None of these are committed work — they are inputs for a product discussion.

| # | Feature | Model | Effort | Notes |
|---|---|---|---|---|
| 1 | **Regulatory report narrative drafting** — auto-draft the CALK narrative sections (`UMUM`, `DASAR_PENYUSUNAN`, `KEBIJAKAN_AKUNTANSI`, `INFORMASI_TAMBAHAN`) from the tenant's COA + period data, for the tenant to review/edit before saving via `PUT /api/reports/regulatory/calk/narrative` | Opus 5 | Medium | Draft only — human-in-the-loop before persisting; matches existing `requirePermission('reports', 'update')` gate |
| 2 | **Member/staff support chat** — answer "why is my SHU this amount" or "what's my loan's current KOL status" using read-only tool calls against tenant-scoped data | Sonnet 5 | Medium–High | Requires tenant-scoped tool implementations; must never expose cross-tenant data |
| 3 | **Transaction categorization assist** — suggest an account mapping for ambiguous transactions during Konfigurasi Akun setup | Haiku 4.5 / Sonnet 5 | Low–Medium | Structured output constrained to valid `Account` IDs for the tenant |
| 4 | **Document OCR intake** — extract fields from scanned KTP/payment proofs during member onboarding or loan disbursement | Sonnet 5 (vision) | Medium | Human review before write; PII handling review needed |
| 5 | **Nightly KOL anomaly review agent** — flag loans whose KOL transition looks inconsistent with the configured thresholds, summarize for manager email (extends `apps/backend/src/jobs/kol-cron.ts`) | Managed Agents (Opus 5) | Medium–High | Read-only; produces a report, doesn't mutate `Loan.kolCategory` itself — the existing `recalculateKOL()` cron remains authoritative |
| 6 | **Natural-language report query** — "show me all members with MACET loans opened this quarter" translated into a scoped, tenant-filtered Prisma query via structured output | Sonnet 5 | High | Highest risk surface — requires a strict allowlist/validation layer between model output and actual query execution to prevent injection or cross-tenant leakage |

---

## 5. Risks & Guardrails Specific to SISKOP

- **Tenant isolation is non-negotiable.** Per `CLAUDE.md`, every query on tenant-scoped models must include `where: { tenantId }`. Any AI feature that calls into the backend must go through the same tenant-scoped service layer as the REST API — never a raw query built from model output.
- **No hard deletes.** An agent or tool given write access must respect `isActive: false` soft-delete semantics; this should be enforced at the tool-function layer, not left to prompting.
- **Currency precision.** Per `docs/api-conventions.md`, monetary values are `Decimal` server-side and strings over the wire. Any model-generated numeric output touching money must be validated/re-derived server-side, not trusted verbatim from the model.
- **Compliance-sensitive content (KOL, regulatory reports)** should default to human review before persistence, matching the existing pattern where `laporan-hasil-usaha` does *not* auto-post a closing journal entry despite the design spec's original proposal (see `docs/api-conventions.md`'s note on deliberate deferral).
- **Data retention for Fable 5**: requires 30-day retention; not relevant unless a future feature specifically needs Fable-5-tier reasoning.

---

## 6. Recommendation

Start with **feature #3 (transaction categorization assist)** or **#1 (CALK narrative drafting)** as a low-risk pilot: both are draft-and-review workflows with an existing human approval step in the current API design, low blast radius if the model is wrong, and a clear win on staff time. Defer the natural-language query feature (#6) and any autonomous write-capable agent until the tenant-isolation and validation layer for model-originated queries has been designed and reviewed separately.

---

## 7. Sources

This document was compiled from Anthropic's current model documentation and API reference material available to Claude Code as of 2026-07-26 (models, pricing, and capability details cached 2026-06-24 per the underlying skill reference; verify current pricing/model availability at platform.claude.com before committing to a build). No external web research was performed; this is a synthesis of first-party Anthropic documentation, not independent benchmarking.
