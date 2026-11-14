import type { PublicPricingCatalog } from "@siskop/types";
import { FAQS, PAGE_DESCRIPTION, PUBLISHER, SITE_NAME } from "./content";
import type { Site } from "./site";

type Json = Record<string, unknown>;
const drop = (object: Json): Json => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null));
const priceOf = (value: string | null) => String(Number(value ?? 0));

export function buildJsonLd(site: Site, catalog: PublicPricingCatalog | null): Json[] {
  const url = site.url;
  const contact = PUBLISHER.email || PUBLISHER.phone
    ? { "@type": "ContactPoint", contactType: "customer support", email: PUBLISHER.email ?? undefined, telephone: PUBLISHER.phone ?? undefined, availableLanguage: "id" }
    : undefined;
  const offers = catalog?.packages
    .filter((p) => !p.isCustom)
    .map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: priceOf(p.priceMonthly),
      priceCurrency: catalog.currency,
      priceSpecification: { "@type": "UnitPriceSpecification", price: priceOf(p.priceMonthly), priceCurrency: catalog.currency, unitText: "MONTH" },
      url: url ? `${url}/#paket` : undefined
    }));
  return [
    drop({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: PUBLISHER.name ?? SITE_NAME,
      url: url ?? undefined,
      logo: url ? `${url}/logo.png` : undefined,
      contactPoint: contact
    }),
    drop({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      description: PAGE_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "id",
      url: url ?? undefined,
      offers: offers && offers.length > 0 ? offers : undefined
    }),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } }))
    }
  ];
}

/** Safe inside <script>: a literal "</script>" or "<!--" in a string cannot end the block. */
export const jsonLdScripts = (items: Json[]) =>
  items.map((item) => `<script type="application/ld+json">${JSON.stringify(item).replace(/</g, "\u003c")}</script>`).join("\n    ");
