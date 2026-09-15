import { validationError } from "../../lib/errors.js";

const RESERVED = new Set(["www", "app", "admin", "api", "auth", "mail", "email", "send", "smtp", "support", "status", "static", "cdn", "assets", "uploads", "billing", "login", "register", "checkout", "firebase", "localhost"]);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function parseSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!LABEL.test(slug) || RESERVED.has(slug) || slug.startsWith("xn--")) {
    throw validationError("Gunakan 1–63 huruf kecil, angka, atau tanda hubung. Nama ini mungkin dicadangkan.");
  }
  return slug;
}

export type HostClassification = { kind: "tenant"; slug: string } | { kind: "central" | "reserved" | "invalid" };
export function classifyHost(authority: string, base: string): HostClassification {
  if (!/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(authority)) return { kind: "invalid" };
  const host = authority.toLowerCase().split(":")[0]!;
  if (host === base) return { kind: "central" };
  if (!host.endsWith(`.${base}`)) return { kind: "invalid" };
  const slug = host.slice(0, -(base.length + 1));
  if (!LABEL.test(slug)) return { kind: "invalid" };
  if (RESERVED.has(slug) || slug.startsWith("xn--")) return { kind: "reserved" };
  return { kind: "tenant", slug };
}

const COOLDOWN_MS = 365 * 24 * 60 * 60 * 1000;
export function nextRenameAt(last: Date | null): Date | null {
  return last ? new Date(last.getTime() + COOLDOWN_MS) : null;
}
export function renameEligibility(facts: {
  enabled: boolean; entitled: boolean; active: boolean; lastChangedAt: Date | null;
}, now = new Date()): "unavailable" | "inactive" | "package" | "cooldown" | null {
  if (!facts.enabled) return "unavailable";
  if (!facts.active) return "inactive";
  if (!facts.entitled) return "package";
  const next = nextRenameAt(facts.lastChangedAt);
  return next && now < next ? "cooldown" : null;
}
