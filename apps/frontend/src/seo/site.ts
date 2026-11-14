/** Hosts that are staging/preview by nature: never indexable, whatever SITE_URL says. */
const NON_PRODUCTION_HOST = /(^|\.)(netlify\.app|vercel\.app|web\.app|firebaseapp\.com|localhost)$|^127\.0\.0\.1$|^\[?::1\]?$/;

export interface Site {
  /** Absolute origin without trailing slash, or null when SITE_URL is missing/invalid. */
  url: string | null;
  /** True only on a real production domain. Controls robots meta, robots.txt and sitemap. */
  indexable: boolean;
}

export function resolveSite(raw: string | undefined): Site {
  try {
    const parsed = new URL(raw?.trim() ?? "");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { url: null, indexable: false };
    const url = parsed.origin;
    return { url, indexable: parsed.protocol === "https:" && !NON_PRODUCTION_HOST.test(parsed.hostname) };
  } catch {
    return { url: null, indexable: false };
  }
}
