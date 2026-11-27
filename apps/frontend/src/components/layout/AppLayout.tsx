import type { TenantSetupStep } from "@siskop/types";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiRequestError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTenantAccessConfig } from "@/features/tenant-access/api";
import { tenantSlug } from "@/features/workspace-domain/host";
import { Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { SetupSpotlight } from "./SetupSpotlight";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { AccessBanner } from "./AccessBanner";
import { CommandPalette } from "./CommandPalette";
import { BrandStyle } from "./BrandStyle";
import { Toaster } from "../ui/toaster";
import { HandoffSessionGate } from "@/features/tenant-access/HandoffSessionGate";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageLoading } from "../shared/LoadingSpinner";

const setupSteps = {
  CAPITAL: { tab: "modal-disetor", label: "Modal disetor", number: 1, instruction: "Isi dan simpan modal disetor koperasi." },
  SAVINGS: { tab: "savings", label: "Simpanan", number: 2, instruction: "Klik Tambah Simpanan, lalu isi dan simpan pengaturannya." },
  LOANS: { tab: "loans", label: "Pinjaman", number: 3, instruction: "Klik Tambah Pinjaman, lalu isi dan simpan pengaturannya." }
} as const;

const RAIL_KEY = "siskop.sidebar.rail";

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

function readSkippedGuide(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const accessConfig = useTenantAccessConfig();
  const user = useAuth((s) => s.user);
  const isPlatformAdmin = useAuth((s) => s.user?.role === "super_admin");
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [skippedGuideKey, setSkippedGuideKey] = useState<string>();
  const guideKey = user ? `siskop.setup.skipped.${user.tenantId}.${user.id}` : "";
  const skippedGuide = Boolean(guideKey && (guideKey === skippedGuideKey || readSkippedGuide(guideKey)));
  const checkingSetup = Boolean(user?.permissions?.config?.update) && !isPlatformAdmin && !skippedGuide;
  const setup = useQuery({
    queryKey: ["workspace-setup", user?.tenantId],
    queryFn: async () => {
      try {
        return await apiFetch<{ setupStep: TenantSetupStep | null }>("/config/setup");
      } catch (error) {
        // The setup endpoint may be absent while the previous backend version is still running.
        if (error instanceof ApiRequestError && error.status === 404 && error.message === "Endpoint not found") {
          return { setupStep: null };
        }
        throw error;
      }
    },
    enabled: checkingSetup
  });

  async function refreshSetup() {
    const result = await setup.refetch();
    if (result.isSuccess && result.data.setupStep === null) {
      toast({ title: "Pengaturan awal selesai" });
      navigate("/dashboard", { replace: true });
    }
  }
  const [rail, setRail] = useState(readRail);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closeMobile = useCallback((open: boolean) => setMobileOpen(open), []);

  function skipGuide() {
    setSkippedGuideKey(guideKey);
    setMobileOpen(false);
    try {
      localStorage.setItem(guideKey, "1");
    } catch {
      // The in-memory choice still applies for this visit.
    }
    requestAnimationFrame(() => document.getElementById("konten")?.focus());
  }

  useEffect(() => {
    // Ctrl/Cmd+K from anywhere in the shell; the palette itself closes on Esc.
    const onKey = (event: KeyboardEvent) => {
      if ((!checkingSetup || !setup.data?.setupStep) && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [checkingSetup, setup.data?.setupStep]);

  const toggleRail = () =>
    setRail((value) => {
      const next = !value;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        // Not persisted when storage is blocked; the toggle still works for this visit.
      }
      return next;
    });

  if (tenantSlug() !== null && new URLSearchParams(location.search).get('handoff') === '1')
    return <HandoffSessionGate />;

  // The access token lives only in memory (stores/auth.ts), so it's always
  // null right after a hard reload — but `user` is cached in localStorage and
  // available synchronously, so the shell renders from it immediately instead
  // of blanking behind a spinner while waiting on a token. Nothing here needs
  // to kick off the refresh itself: Sidebar's useIsMultiUnit() (and whichever
  // page query fires first) will 401 once with no token and transparently
  // refresh-and-retry via withAuthRetry (api/client.ts) — same shared,
  // deduped refresh call as a token expiring mid-session. If that refresh
  // genuinely fails (dead session), those queries clear() the auth store,
  // `user` becomes null, and this redirects to /login on the next render.
  if (tenantSlug() === null && !isPlatformAdmin) {
    if (accessConfig.isPending) return <p role="status" className="p-8">Memeriksa alamat koperasi…</p>;
    if (accessConfig.isError) return <p role="alert" className="p-8">Belum dapat memeriksa akses. <button onClick={() => void accessConfig.refetch()}>Coba lagi</button></p>;
    if (accessConfig.data?.enabled) return <Navigate to="/login?select=1" replace />;
  }
  if (!user) return <Navigate to="/login" replace />;

  // Platform admins are attached to a real tenant's role purely to satisfy a
  // DB FK (see modules/platform/service.ts) — that must not let them browse
  // into that tenant's business routes by URL, even though their JWT carries
  // real permissions for it. Confine them to /platform/* (+ their own /profile).
  const allowedForPlatformAdmin = location.pathname.startsWith("/platform") || location.pathname === "/profile";
  if (isPlatformAdmin && !allowedForPlatformAdmin) {
    return <Navigate to="/platform/dashboard" replace />;
  }

  const setupStep = checkingSetup ? setup.data?.setupStep : null;
  const guide = setupStep ? setupSteps[setupStep] : null;
  const inSettings = location.pathname === "/config";
  const onGuideTab = inSettings && (new URLSearchParams(location.search).get("tab") ?? "savings") === guide?.tab;

  return (
    <div data-setup-shell className="flex min-h-screen bg-background">
      <a
        href="#konten"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-primary-foreground"
      >
        Lewati ke konten
      </a>
      <Sidebar rail={rail} mobileOpen={mobileOpen} onMobileOpenChange={closeMobile} highlightSettings={Boolean(guide && !inSettings)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          rail={rail}
          onToggleRail={toggleRail}
          onOpenMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <AccessBanner />
        <main id="konten" tabIndex={-1} className="w-full max-w-[1500px] flex-1 px-4 pb-10 pt-[22px] outline-none min-[901px]:px-6">
          {guide && (
            <section aria-label="Panduan pengaturan awal" className="relative z-[52] mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/50 bg-accent px-4 py-3 text-accent-foreground">
              <div aria-live="polite">
                <p className="text-sm font-bold">Panduan pengaturan awal · {guide.number}/3 · {guide.label}</p>
                <p className="mt-1 text-sm">
                  {onGuideTab ? guide.instruction : inSettings ? `Pilih ${guide.label} untuk melanjutkan.` : `Buka Pengaturan, lalu pilih ${guide.label}.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!inSettings && <Button data-setup-target="menu" size="sm" variant="outline" className="min-[901px]:hidden" onClick={() => setMobileOpen(true)}>Buka menu</Button>}
                <Button data-setup-skip type="button" size="sm" variant="outline" onClick={skipGuide}>
                  Lewati panduan
                </Button>
              </div>
            </section>
          )}
          {checkingSetup && setup.isError && (
            <div role="status" className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              Panduan pengaturan awal belum dapat dimuat.
              <Button size="sm" variant="outline" onClick={() => void setup.refetch()}>Coba lagi</Button>
            </div>
          )}
          <Suspense fallback={<PageLoading />}>
            <Outlet context={guide ? { tab: guide.tab, refreshSetup } : undefined} />
          </Suspense>
        </main>
      </div>
      <BrandStyle />
      {guide && !setup.isError && <SetupSpotlight routeKey={`${location.key}:${guide.tab}`} inSettings={inSettings} onGuideTab={onGuideTab} />}
      <CommandPalette open={!guide && paletteOpen} onOpenChange={setPaletteOpen} />
      <Toaster />
    </div>
  );
}
