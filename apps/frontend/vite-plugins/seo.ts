import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, loadEnv, type Plugin } from "vite";
import type { PublicPricingCatalog } from "@siskop/types";
import { headTags, llmsTxt, notFoundHtml, pricingMd, robotsTxt, sitemapXml } from "../src/seo/files";
import { buildJsonLd, jsonLdScripts } from "../src/seo/jsonld";
import { resolveSite, type Site } from "../src/seo/site";

/**
 * SEO + AEO for the landing page, at build time:
 *  - head tags, canonical, Open Graph, JSON-LD (index.html placeholders)
 *  - the landing page rendered into the initial HTML (crawlers that run no JS)
 *  - robots.txt, sitemap.xml, pricing.md, llms.txt, 404.html
 * Everything is driven by SITE_URL (and optionally PRICING_API_URL). See docs/seo/README.md.
 */
export function seoPlugin(): Plugin {
  let site: Site = { url: null, indexable: false };
  let build_ = false;
  let catalog: PublicPricingCatalog | null = null;
  let app = { html: "", state: null as unknown };
  let pricingUrl: string | null = null;
  let root = "";
  let mode = "";

  return {
    name: "siskop-seo",
    configResolved(config) {
      build_ = config.command === "build";
      const env = { ...loadEnv(config.mode, config.envDir || config.root, ""), ...process.env };
      site = resolveSite(env.SITE_URL);
      pricingUrl = env.PRICING_API_URL || (site.url ? `${site.url}/api/public/pricing` : null);
      root = config.root;
      mode = config.mode;
    },

    async buildStart() {
      if (!build_) return;
      catalog = await fetchCatalog(pricingUrl);
      if (!catalog) this.warn(`SEO: no pricing catalog (${pricingUrl ?? "no SITE_URL / PRICING_API_URL"}); pricing table, pricing.md and Offer JSON-LD are left as TODO.`);
      try {
        app = await renderLanding(root, mode, catalog);
      } catch (error) {
        this.warn(`SEO: prerender failed, shipping an empty #root. ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!site.indexable) this.warn(`SEO: SITE_URL ${site.url ?? "(unset)"} is not a production domain, so this build is noindex.`);
    },

    transformIndexHtml(html, ctx) {
      const jsonLd = jsonLdScripts(buildJsonLd(site, catalog));
      const state = app.state
        ? `<script id="siskop-query-state" type="application/json">${JSON.stringify(app.state).replace(/</g, "\\u003c")}</script>\n    `
        : "";
      // Only "/" is prerendered: any other path must not flash landing content before the app mounts.
      const guard = `<script>if(location.pathname!=="/")document.getElementById("root").textContent=""</script>`;
      const fonts = Object.keys(ctx.bundle ?? {})
        .filter((name) => /manrope-latin-(400|600)-normal.*\.woff2$/.test(name))
        .map((name) => ({
          tag: "link",
          attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: "", href: `/${name}` },
          injectTo: "head" as const
        }));
      return {
        html: html
          .replace("<!--seo-head-->", () => `${headTags(site)}\n    ${jsonLd}`)
          .replace("<!--seo-app-->", () => app.html)
          .replace("<!--seo-state-->", () => `${guard}\n    ${state}`),
        tags: fonts
      };
    },

    generateBundle() {
      if (!build_) return;
      const emit = (fileName: string, source: string) => this.emitFile({ type: "asset", fileName, source });
      emit("robots.txt", robotsTxt(site));
      const sitemap = sitemapXml(site);
      if (sitemap) emit("sitemap.xml", sitemap);
      emit("pricing.md", pricingMd(site, catalog));
      emit("llms.txt", llmsTxt(site));
      emit("404.html", notFoundHtml());
    }
  };
}

async function fetchCatalog(url: string | null): Promise<PublicPricingCatalog | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const body = (await response.json()) as { success?: boolean; data?: PublicPricingCatalog };
    return response.ok && body.success && Array.isArray(body.data?.packages) && body.data.packages.length > 0 ? body.data : null;
  } catch {
    return null;
  }
}

/** Bundles src/seo/prerender.tsx for Node (no browser needed, so it works in CI), runs it, cleans up. */
async function renderLanding(root: string, mode: string, data: PublicPricingCatalog | null) {
  const outDir = path.join(root, "node_modules", ".cache", "siskop-seo");
  await build({
    root,
    mode,
    configFile: false,
    logLevel: "error",
    publicDir: false,
    resolve: { alias: { "@": path.resolve(root, "src") } },
    build: {
      ssr: path.resolve(root, "src/seo/prerender.tsx"),
      outDir,
      emptyOutDir: true,
      minify: false,
      copyPublicDir: false,
      rollupOptions: { output: { format: "es", entryFileNames: "prerender.mjs" } }
    }
  });
  try {
    const module = (await import(`${pathToFileURL(path.join(outDir, "prerender.mjs")).href}?t=${Date.now()}`)) as {
      prerender(catalog: PublicPricingCatalog | null): Promise<{ html: string; state: unknown }>;
    };
    return await module.prerender(data);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
