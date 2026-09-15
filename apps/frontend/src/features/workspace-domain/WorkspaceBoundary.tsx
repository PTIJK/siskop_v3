import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiResponse, WorkspaceContext } from "@siskop/types";
import { canonicalWorkspaceUrl, tenantSlug } from "./host";

const Context = createContext<WorkspaceContext | null>(null);
export const useWorkspace = () => useContext(Context);
export function WorkspaceBoundary({ children }: { children: ReactNode }) {
  const isTenant = tenantSlug() !== null && Boolean(import.meta.env.VITE_TENANT_BASE_DOMAIN);
  const query = useQuery({
    queryKey: ["workspace", window.location.hostname], enabled: isTenant, retry: false, staleTime: 0,
    queryFn: async () => {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const result = await response.json() as ApiResponse<WorkspaceContext | null>;
      if (!response.ok || !result.success || !result.data) throw new Error(result.error?.message ?? "Workspace tidak tersedia.");
      if (result.data.isAlias) window.location.replace(canonicalWorkspaceUrl(result.data.canonicalLoginUrl, true));
      return result.data;
    }
  });
  if (!isTenant) return children;
  if (query.isPending || query.data?.isAlias) return <main className="p-8" role="status">Memuat workspace…</main>;
  if (query.isError) return <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
    <h1 className="text-2xl font-semibold">Workspace tidak tersedia</h1>
    <p role="alert">{query.error.message}</p>
    <a href={import.meta.env.VITE_PUBLIC_APP_URL ?? "https://siskop-d0f8c.web.app"}>Kembali ke SISKOP</a>
  </main>;
  return <Context.Provider value={query.data ?? null}>{children}</Context.Provider>;
}
