import type { NextFunction, Request, Response } from "express";
import { featureNotEntitled, paymentRequired } from "../lib/errors.js";
import { getTenantEntitlements } from "../lib/pricing/entitlements.js";
import { enforcementMode } from "../lib/pricing/flags.js";
import { verifyAccessToken } from "./auth.js";

/**
 * The Pricing V2 enforcement map (spec section 9), kept in one place so a
 * reviewer can read every gate at once. First matching rule wins, so a
 * specific path sits above the general one it refines. A path with no rule is
 * a core module that every package includes (savings and loan transactions,
 * expenses, notifications).
 */
interface Rule {
  /** Path prefix, matched on whole segments: "/members" matches "/members/1" but not "/membersX". */
  prefix: string;
  /** Limits the rule to these methods; omitted means all. */
  methods?: readonly string[];
  /** Every one of these features must be in the subscription. */
  features: readonly string[];
}

const WRITES = ["POST", "PUT", "PATCH", "DELETE"] as const;

const RULES: readonly Rule[] = [
  { prefix: "/reports/financial", features: ["reports_financial"] },
  { prefix: "/reports/rat", features: ["reports_financial"] },
  { prefix: "/reports/regulatory", features: ["reports_regulatory"] },
  { prefix: "/reports/pasar", features: ["reports_market"] },
  { prefix: "/reports/accounting", features: ["accounting_book"] },
  { prefix: "/reports/portfolio", features: ["portfolio_quality"] },
  { prefix: "/reports", features: ["reports"] },
  { prefix: "/ksu", features: ["reports_consolidated"] },

  { prefix: "/journal/year-close", features: ["period_closing"] },
  { prefix: "/journal", features: ["manual_journal"] },

  { prefix: "/config/accounts/generate-standard", features: ["coa_standard_template"] },
  { prefix: "/config/accounts", features: ["config_coa"] },
  { prefix: "/config/journal", features: ["accounting_book"] },
  { prefix: "/config/account-mappings", features: ["config_account_mapping"] },
  { prefix: "/config/shu-distribution", features: ["config_shu"] },
  { prefix: "/config/whitelabel", features: ["whitelabel"] },
  { prefix: "/config/modal-disetor", features: ["paid_in_capital"] },
  { prefix: "/config/self-registration", features: ["self_registration"] },
  { prefix: "/config/holidays", features: ["config_holidays"] },
  { prefix: "/config/operating-days", features: ["config_holidays"] },
  // Reading units and roles is needed everywhere (unit pickers, user forms); only changing them is a feature.
  { prefix: "/config/units", methods: WRITES, features: ["config_branch_units"] },
  { prefix: "/config/roles", methods: WRITES, features: ["config_roles"] },
  { prefix: "/users", features: ["config_users"] },
  { prefix: "/savings/configs", methods: WRITES, features: ["config_saving"] },
  { prefix: "/loans/configs", methods: WRITES, features: ["config_loan"] },
  { prefix: "/tenant-domain", features: ["workspace_address"] },

  { prefix: "/members/registration-requests", features: ["self_registration"] },
  { prefix: "/members/self-registration-link", features: ["self_registration"] },
  { prefix: "/members", features: ["members"] },
  { prefix: "/audit-log", features: ["audit_trail"] },
  { prefix: "/dashboard/pasar", features: ["unit_pasar"] },
  { prefix: "/dashboard", features: ["dashboard"] },

  { prefix: "/konsumen/pos/credit", features: ["unit_konsumen", "member_receivables"] },
  { prefix: "/konsumen", features: ["unit_konsumen"] },
  { prefix: "/market", features: ["unit_pasar"] },
  { prefix: "/collections", features: ["unit_pasar"] }
];

function normalise(path: string): string {
  const bare = (path.split("?")[0] ?? "").toLowerCase();
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The features a request needs, given its path below /api. Empty when it is a core route. */
export function featuresForRequest(method: string, path: string): readonly string[] {
  const p = normalise(path);
  const verb = method.toUpperCase();
  const rule = RULES.find((r) => under(p, r.prefix) && (!r.methods || r.methods.includes(verb)));
  return rule ? rule.features : [];
}

/**
 * Routes a blocked tenant must still reach: signing in and out, the
 * subscription page that explains what to pay, and notifications.
 */
const STATUS_EXEMPT = ["/auth", "/config/subscription", "/notifications"] as const;

export function isStatusExempt(path: string): boolean {
  const p = normalise(path);
  return STATUS_EXEMPT.some((prefix) => under(p, prefix));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type Standing = { ok: true } | { ok: false; reason: "NO_SUBSCRIPTION" | "PENDING_PAYMENT" | "PAST_DUE" | "CANCELLED" };

/** Past due is read-only: the koperasi can still see and export its own data, but cannot add to it. */
function standing(status: string | undefined, method: string): Standing {
  if (status === undefined) return { ok: false, reason: "NO_SUBSCRIPTION" };
  if (status === "ACTIVE") return { ok: true };
  if (status === "PAST_DUE") return SAFE_METHODS.has(method) ? { ok: true } : { ok: false, reason: "PAST_DUE" };
  return { ok: false, reason: status === "CANCELLED" ? "CANCELLED" : "PENDING_PAYMENT" };
}

const REASON_MESSAGE: Record<string, string> = {
  NO_SUBSCRIPTION: "Koperasi ini belum memiliki langganan aktif.",
  PENDING_PAYMENT: "Langganan belum aktif: selesaikan pembayaran faktur pendaftaran.",
  PAST_DUE: "Pembayaran langganan terlambat. Data hanya dapat dilihat sampai faktur dilunasi.",
  CANCELLED: "Langganan telah dihentikan."
};

/**
 * Mounted once, ahead of every /api router, so no route can forget its check.
 * Reads the staff access token itself (an absent or invalid one is left for
 * the router's own requireAuth to reject) and applies, in order: the
 * subscription's payment standing, then the features the route needs.
 * Platform admins are exempt. PRICING_V2_ENFORCEMENT picks the effect:
 * off does nothing, shadow only logs, on blocks.
 */
export function tenantEnforcement() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const mode = enforcementMode();
      if (mode === "off") return next();

      const header = req.headers.authorization ?? "";
      if (!header.startsWith("Bearer ")) return next();
      let claims;
      try {
        claims = verifyAccessToken(header.slice(7), process.env.JWT_SECRET ?? "");
      } catch {
        return next();
      }
      if (claims.role === "super_admin") return next();

      const { tenantId } = claims;
      const ent = await getTenantEntitlements(tenantId);

      const state = standing(ent?.status, req.method.toUpperCase());
      if (!state.ok && !isStatusExempt(req.path)) {
        if (mode === "on") throw paymentRequired(REASON_MESSAGE[state.reason] ?? "Pembayaran diperlukan", { reason: state.reason });
        console.warn(`PRICING_SHADOW PAYMENT_REQUIRED tenant=${tenantId} reason=${state.reason} ${req.method} ${req.path}`);
      }

      for (const key of featuresForRequest(req.method, req.path)) {
        if (ent?.hasFeature(key)) continue;
        if (mode === "on") throw featureNotEntitled("Paket langganan Anda tidak mencakup fitur ini", { feature: key });
        console.warn(`PRICING_SHADOW FEATURE_NOT_ENTITLED tenant=${tenantId} feature=${key} ${req.method} ${req.path}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
