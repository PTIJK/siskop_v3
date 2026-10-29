export type EnforcementMode = "off" | "shadow" | "on";

/**
 * PRICING_V2_ENFORCEMENT rollout switch. `off` (default): nothing is checked.
 * `shadow`: breaches are logged, never blocked. `on`: breaches are blocked.
 * Read per call so a deploy-time env change needs no code change.
 */
export function enforcementMode(): EnforcementMode {
  const v = process.env.PRICING_V2_ENFORCEMENT;
  return v === "on" || v === "shadow" ? v : "off";
}
