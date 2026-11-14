import { describe, expect, it } from "vitest";
import type { PublicPricingCatalog } from "@siskop/types";
import { buildJsonLd, jsonLdScripts } from "./jsonld";
import { resolveSite } from "./site";

const catalog = {
  version: 1,
  currency: "IDR",
  packages: [
    { code: "free", name: "Free", isCustom: false, sortOrder: 1, priceMonthly: null, priceYearly: null, limits: {}, features: [] },
    { code: "small", name: "Small", isCustom: false, sortOrder: 2, priceMonthly: "500000.00", priceYearly: "5000000.00", limits: {}, features: [] },
    { code: "custom", name: "Custom", isCustom: true, sortOrder: 9, priceMonthly: null, priceYearly: null, limits: {}, features: [] }
  ]
} as unknown as PublicPricingCatalog;

describe("resolveSite", () => {
  it("treats a real https domain as indexable", () => {
    expect(resolveSite("https://siskop.co.id/")).toEqual({ url: "https://siskop.co.id", indexable: true });
  });
  it.each([undefined, "", "not a url", "https://a.netlify.app", "https://x.vercel.app", "https://siskop-d0f8c.web.app", "http://localhost:3000", "http://siskop.co.id"])(
    "is never indexable for %s",
    (value) => expect(resolveSite(value).indexable).toBe(false)
  );
});

describe("buildJsonLd", () => {
  const site = resolveSite("https://siskop.co.id");
  it("emits Organization, SoftwareApplication and FAQPage", () => {
    const types = buildJsonLd(site, catalog).map((item) => item["@type"]);
    expect(types).toEqual(["Organization", "SoftwareApplication", "FAQPage"]);
  });
  it("builds offers only from real, non-custom packages", () => {
    const app = buildJsonLd(site, catalog)[1] as { offers: { name: string; price: string }[] };
    expect(app.offers.map((o) => [o.name, o.price])).toEqual([["Free", "0"], ["Small", "500000"]]);
  });
  it("omits offers and urls when there is no catalog or SITE_URL", () => {
    const [org, app] = buildJsonLd(resolveSite(undefined), null);
    expect(app).not.toHaveProperty("offers");
    expect(org).not.toHaveProperty("url");
  });
  it("round-trips as valid JSON and cannot close the script tag", () => {
    const html = jsonLdScripts(buildJsonLd(site, catalog));
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)];
    expect(blocks).toHaveLength(3);
    for (const [, body] of blocks) expect(() => JSON.parse(body!)).not.toThrow();
  });
});
