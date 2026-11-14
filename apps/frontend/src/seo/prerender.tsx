/**
 * Build-time render of the landing page ("/") to HTML, so crawlers (most AI crawlers
 * run no JavaScript) get the real content. Bundled and run by vite-plugins/seo.ts only;
 * never imported by the app. Keep the tree shape identical to App.tsx: a Suspense boundary
 * around the page, no extra DOM, or hydration will not match.
 */
import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { QueryClient, QueryClientProvider, dehydrate, type DehydratedState } from "@tanstack/react-query";
import type { PublicPricingCatalog } from "@siskop/types";

export async function prerender(catalog: PublicPricingCatalog | null): Promise<{ html: string; state: DehydratedState | null }> {
  // Some app modules (the auth store) read localStorage when first imported. Node has none, so give
  // the import an empty one, and import the page lazily so the shim is in place first.
  const missing = typeof globalThis.localStorage === "undefined";
  if (missing) Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
  const { default: LandingPage } = await import("@/features/onboarding/pages/LandingPage");
  if (missing) delete (globalThis as { localStorage?: unknown }).localStorage;
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
  if (catalog) client.setQueryData(["public-pricing"], catalog);
  const html = renderToString(
    <QueryClientProvider client={client}>
      <StaticRouter location='/'>
        <Suspense fallback={null}>
          <LandingPage />
        </Suspense>
      </StaticRouter>
    </QueryClientProvider>
  );
  return { html, state: catalog ? dehydrate(client) : null };
}
