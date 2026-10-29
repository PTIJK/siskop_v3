import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/members", search: "" }),
  Navigate: () => null,
  Outlet: () => { throw new Promise(() => {}); }
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (select: (state: { user: { role: string } }) => unknown) => select({ user: { role: "admin" } })
}));
vi.mock("@/features/tenant-access/api", () => ({ useTenantAccessConfig: () => ({ data: { enabled: false } }) }));
vi.mock("@/features/workspace-domain/host", () => ({ tenantSlug: () => "demo" }));
vi.mock("./Sidebar", () => ({ Sidebar: () => <aside>Navigation</aside> }));
vi.mock("./AccessBanner", () => ({ AccessBanner: () => null }));
vi.mock("./CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./Topbar", () => ({ Topbar: () => <header>Page header</header> }));
vi.mock("../ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/features/tenant-access/HandoffSessionGate", () => ({ HandoffSessionGate: () => null }));

describe("route loading", () => {
  it("keeps navigation and the header visible while a page module is pending", () => {
    const html = renderToString(
      <Suspense fallback={<p>Application loading</p>}>
        <AppLayout />
      </Suspense>
    );
    expect(html).toContain("<aside>Navigation</aside>");
    expect(html).toContain("<header>Page header</header>");
    expect(html).toContain('role="status"');
    expect(html).toContain("Memuat halaman");
    expect(html).not.toContain("<p>Application loading</p>");
  });
});
