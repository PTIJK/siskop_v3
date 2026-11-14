import { describe, expect, it } from "vitest";
import { headTags, llmsTxt, pricingMd, robotsTxt, sitemapXml } from "./files";
import { resolveSite } from "./site";

const prod = resolveSite("https://siskop.co.id");
const staging = resolveSite("https://siskop-d0f8c.web.app");

describe("robots.txt", () => {
  it("blocks everything on staging and lists no sitemap", () => {
    const text = robotsTxt(staging);
    expect(text).toContain("Disallow: /");
    expect(text).not.toContain("Sitemap");
  });
  it("allows AI search crawlers, blocks CCBot, and points at SITE_URL's sitemap in production", () => {
    const text = robotsTxt(prod);
    for (const bot of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Googlebot", "Bingbot", "GPTBot", "Google-Extended"])
      expect(text).toContain(`User-agent: ${bot}`);
    expect(text).toMatch(/User-agent: CCBot\nDisallow: \/\n/);
    expect(text).toContain("Sitemap: https://siskop.co.id/sitemap.xml");
  });
});

describe("sitemap and head", () => {
  it("has no sitemap on staging", () => expect(sitemapXml(staging)).toBeNull());
  it("lists the home page on production", () => expect(sitemapXml(prod)).toContain("<loc>https://siskop.co.id/</loc>"));
  it("adds noindex only off production", () => {
    expect(headTags(staging)).toContain('content="noindex, nofollow"');
    expect(headTags(prod)).not.toContain('<meta name="robots"');
    expect(headTags(prod)).toContain('rel="canonical" href="https://siskop.co.id/"');
  });
  it("omits canonical and absolute image URLs when SITE_URL is unset", () => {
    const tags = headTags(resolveSite(undefined));
    expect(tags).not.toContain("canonical");
    expect(tags).not.toContain("og:image");
  });
});

describe("pricing.md and llms.txt", () => {
  it("never invents prices: without a catalog it says TODO", () => {
    expect(pricingMd(prod, null)).toContain("TODO");
    expect(pricingMd(prod, null)).not.toMatch(/Rp/);
  });
  it("links to pricing.md from llms.txt", () => expect(llmsTxt(prod)).toContain("https://siskop.co.id/pricing.md"));
});
