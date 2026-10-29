import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { WorkspaceBoundary } from "./features/workspace-domain/WorkspaceBoundary";
import "./index.css";
import { applyTheme, resolveTheme } from "./lib/theme";

// Before first paint, so a dark-theme user never sees a white flash.
applyTheme(resolveTheme());

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } }
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('Missing #root element in index.html');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WorkspaceBoundary><App /></WorkspaceBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);
