import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, hydrate } from "@tanstack/react-query";
import App from "./App";
import { WorkspaceBoundary } from "./features/workspace-domain/WorkspaceBoundary";
import "./index.css";
import { applyTheme, resolveTheme } from "./lib/theme";
import { initAnalytics } from "./lib/analytics";
import { workspaceSlug } from "./features/onboarding/workspace";

// Marketing/onboarding site only: tenant workspaces (<slug>.<base-domain>) hold member data.
if (workspaceSlug() === null) initAnalytics();

// Before first paint, so a dark-theme user never sees a white flash.
applyTheme(resolveTheme());

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } }
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('Missing #root element in index.html');

const app = (
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WorkspaceBoundary><App /></WorkspaceBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);

// The build prerenders the landing page ("/") into #root (vite-plugins/seo.ts). Hydrate it
// only where it is still valid: on "/" of the central host. Anywhere else, start clean.
const prerendered = rootElement.hasChildNodes() && window.location.pathname === "/" && workspaceSlug() === null;
if (prerendered) {
  const saved = document.getElementById("siskop-query-state")?.textContent;
  if (saved) hydrate(queryClient, JSON.parse(saved));
  ReactDOM.hydrateRoot(rootElement, app);
} else {
  rootElement.textContent = "";
  ReactDOM.createRoot(rootElement).render(app);
}
