import type { PublicPricingCatalog } from "@siskop/types";
import { DEFINITION, LAST_UPDATED, LOCALE, PAGE_DESCRIPTION, PAGE_TITLE, PUBLISHER, SITE_NAME } from "./content";
import type { Site } from "./site";

type Catalog = PublicPricingCatalog;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rp = (value: string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value)).replace(/\s/g, "");
const amount = (n: number | null, noun: string) => (n === null ? `${noun} tanpa batas` : `${n.toLocaleString("id-ID")} ${noun}`);

// Not public pages, never useful in search. Every crawler group repeats the same rules,
// because a bot that matches a named group ignores the "*" group.
const PRIVATE_PATHS = ["/api/", "/auth/", "/uploads/", "/checkout", "/dashboard", "/login"];
const ALLOWED_BOTS = ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot", "PerplexityBot", "ClaudeBot", "Google-Extended", "*"];

export function robotsTxt(site: Site): string {
  if (!site.indexable)
    return "# Staging / preview: do not crawl. SITE_URL is unset or is not a production domain.\nUser-agent: *\nDisallow: /\n";
  return [
    "# Crawler policy. Edit the lists below to change who may read this site.",
    "# Decision: allow search and AI-citation crawlers (Googlebot, Bingbot, OAI-SearchBot,",
    "# ChatGPT-User, PerplexityBot, ClaudeBot) and AI-training crawlers (GPTBot, Google-Extended).",
    "# To opt out of training only, move GPTBot and Google-Extended into the blocked group.",
    ...ALLOWED_BOTS.map((bot) => `User-agent: ${bot}`),
    "Allow: /",
    ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
    "",
    "# Blocked: Common Crawl.",
    "User-agent: CCBot",
    "Disallow: /",
    "",
    `Sitemap: ${site.url}/sitemap.xml`,
    ""
  ].join("\n");
}

export function sitemapXml(site: Site): string | null {
  if (!site.indexable) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${site.url}/</loc>\n    <lastmod>${LAST_UPDATED}</lastmod>\n  </url>\n</urlset>\n`;
}

const contactLines = () => {
  const lines = [
    PUBLISHER.name && `Penerbit: ${PUBLISHER.name}`,
    PUBLISHER.email && `Email: ${PUBLISHER.email}`,
    PUBLISHER.phone && `Telepon/WhatsApp: ${PUBLISHER.phone}`
  ].filter(Boolean) as string[];
  return lines.length > 0 ? lines : ["TODO: isi nama penerbit dan kontak resmi di src/seo/content.ts (PUBLISHER)."];
};

export function pricingMd(site: Site, catalog: Catalog | null): string {
  const out = [`# Paket dan harga ${SITE_NAME}`, "", `Terakhir diperbarui: ${LAST_UPDATED}. Mata uang: rupiah (IDR).`];
  if (site.url) out.push(`Halaman resmi: ${site.url}/#paket`);
  out.push("");
  if (!catalog) {
    out.push("TODO: data harga belum tersedia saat build ini. Set PRICING_API_URL ke katalog publik yang sudah dipublikasikan, lalu build ulang.", "");
  } else {
    const tax = Number(catalog.settings.taxRate);
    out.push(tax > 0 ? `Semua harga belum termasuk PPN ${+(tax * 100).toFixed(2)}%.` : "Semua harga belum termasuk PPN.", "");
    for (const pkg of catalog.packages) {
      const limits = pkg.isCustom ? catalog.settings.customBaseLimits : pkg.limits;
      out.push(`## ${pkg.name}`, "");
      if (pkg.isCustom) out.push("- Harga: sesuai fitur yang dipilih (susun sendiri paketnya)");
      else if (pkg.priceMonthly === null) out.push("- Harga: gratis");
      else {
        out.push(`- Harga bulanan: ${rp(pkg.priceMonthly)} per bulan`);
        if (pkg.priceYearly !== null) out.push(`- Harga tahunan: ${rp(pkg.priceYearly)} per tahun`);
      }
      out.push(
        `- Batas: ${amount(limits.members, "anggota")}, ${amount(limits.users, "pengguna")}, ${amount(limits.savingTypes, "jenis simpanan")}, ${amount(limits.loanTypes, "jenis pinjaman")}`
      );
      const names = pkg.isCustom ? [] : catalog.features.filter((f) => pkg.features.includes(f.key)).map((f) => f.name);
      if (names.length > 0) out.push(`- Fitur: ${names.join(", ")}`);
      out.push("");
    }
  }
  out.push("## Kontak", "", ...contactLines(), "");
  return out.join("\n");
}

export function llmsTxt(site: Site): string {
  const base = site.url ?? "";
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${DEFINITION}`,
    "",
    "Untuk siapa: pengurus koperasi simpan pinjam, konsumen, produsen, jasa, dan pemasaran di Indonesia.",
    "",
    "## Tautan",
    "",
    `- [Halaman utama](${base}/): fitur, paket, dan tanya jawab`,
    `- [Paket dan harga](${base}/pricing.md): harga, batas kuota, dan fitur tiap paket`,
    "",
    "## Kontak",
    "",
    ...contactLines(),
    ""
  ].join("\n");
}

/** Head tags that depend on SITE_URL. Title, description and social basics are always present. */
export function headTags(site: Site): string {
  const tags = [
    `<title>${esc(PAGE_TITLE)}</title>`,
    `<meta name="description" content="${esc(PAGE_DESCRIPTION)}" />`,
    `<meta name="theme-color" content="#0d0f15" />`,
    `<link rel="icon" type="image/png" href="/logo.png" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="${LOCALE}" />`,
    `<meta property="og:title" content="${esc(PAGE_TITLE)}" />`,
    `<meta property="og:description" content="${esc(PAGE_DESCRIPTION)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(PAGE_TITLE)}" />`,
    `<meta name="twitter:description" content="${esc(PAGE_DESCRIPTION)}" />`
  ];
  if (site.url) {
    tags.push(
      `<link rel="canonical" href="${site.url}/" />`,
      `<meta property="og:url" content="${site.url}/" />`,
      `<meta property="og:image" content="${site.url}/og-image.png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="SISKOP, aplikasi koperasi untuk anggota, simpanan, dan pinjaman" />`,
      `<meta name="twitter:image" content="${site.url}/og-image.png" />`
    );
  }
  if (!site.indexable) tags.push(`<meta name="robots" content="noindex, nofollow" />`);
  else if (site.url) {
    // The same build is served on tenant hosts (<slug>.<base-domain>): keep those out of the index.
    const host = new URL(site.url).hostname;
    tags.push(
      `<script>if(location.hostname!==${JSON.stringify(host)}){var m=document.createElement("meta");m.name="robots";m.content="noindex, nofollow";document.head.appendChild(m)}</script>`
    );
  }
  return tags.join("\n    ");
}

export function notFoundHtml(): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>Halaman tidak ditemukan | ${SITE_NAME}</title>
    <style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0d0f15;color:#e8ece9;text-align:center;padding:24px}a{color:#34d399}h1{font-size:1.75rem;margin:0 0 8px}p{margin:0 0 20px;color:#a8b3ad}</style>
  </head>
  <body>
    <main>
      <h1>Halaman tidak ditemukan</h1>
      <p>Alamat yang Anda buka tidak ada atau sudah dipindahkan.</p>
      <a href="/">Kembali ke beranda ${SITE_NAME}</a>
    </main>
  </body>
</html>
`;
}
