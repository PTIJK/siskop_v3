import { NavLink, Outlet, useParams } from "react-router-dom";
import { CooperativeType, type PermissionAction, type PermissionModule } from "@siskop/types";
import { useAccessibleUnits } from "@/hooks/useAccessibleUnits";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader, PageHeaderLevelContext } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UNIT_TYPE_ICON, UNIT_TYPE_LABEL } from "@/lib/unitTypeMeta";
import { cn } from "@/lib/utils";

interface UnitTab {
  path: string;
  label: string;
  /** Hide the tab from callers without this permission (the API enforces it regardless). */
  requires?: [PermissionModule, PermissionAction];
}

/** Tabs shown only for a KONSUMEN-type unit — extend this array to add another, the isKonsumen gate below wraps all of them alike. */
const KONSUMEN_TABS: UnitTab[] = [
  { path: "products", label: "Produk" },
  { path: "stock", label: "Stok" },
  { path: "pos", label: "POS" },
  { path: "ppob", label: "PPOB" },
  // Carries HPP and margin, so it follows the same reports.read gate as every
  // other report — a Kasir (Toko-only, no reports access) never sees this tab.
  { path: "report", label: "Laporan", requires: ["reports", "read"] }
];

/**
 * Per-unit detail shell at /ksu/units/:unitId (nested routes render inside
 * via <Outlet/>). There is no `GET /api/config/units/:id` — only list — so
 * this reuses the same `["config","units"]` cached CooperativeUnit[] every
 * other unit-related consumer shares (useIsMultiUnit.ts, UnitsPage.tsx,
 * UnitsTab.tsx) and `select`s the one unit out of it, the same pattern
 * useIsMultiUnit.ts uses to derive its boolean from that cache.
 *
 * The KONSUMEN-type tab gate here is a DIFFERENT, per-unit gate from
 * RequireMultiUnit's tenant-level isMultiUnit gate: a KSU tenant with one KSP
 * unit and one Toko unit shows different tabs depending on which specific
 * unit is being viewed. Any tenant with at least one unit can reach this
 * page for that unit, single-unit or not — this route is intentionally NOT
 * wrapped in RequireMultiUnit.
 */
export function UnitLayout() {
  const { unitId } = useParams<{ unitId: string }>();
  const { can } = usePermissions();

  const { data: units, isPending, isError } = useAccessibleUnits();
  const unit = units?.find((u) => u.id === unitId);

  if (isPending) return <PageLoading />;

  if (isError || !unit) {
    return (
      <Card>
        <CardContent role="alert" className="py-6 text-sm font-semibold text-destructive">Unit usaha tidak ditemukan atau Anda tidak punya akses ke unit ini.</CardContent>
      </Card>
    );
  }

  const Icon = UNIT_TYPE_ICON[unit.type];
  const isKonsumen = unit.type === CooperativeType.KONSUMEN;
  const basePath = `/ksu/units/${unit.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={unit.name}
        breadcrumb={[{ label: "Unit usaha", href: "/ksu/units" }, { label: unit.name }]}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {UNIT_TYPE_LABEL[unit.type]}
            </Badge>
            {!unit.isActive && <Badge variant="secondary">Nonaktif</Badge>}
          </div>
        }
      />

      {isKonsumen ? (
        <>
          <nav aria-label="Bagian unit" className="inline-flex min-h-[44px] max-w-full items-center justify-start gap-1 overflow-x-auto rounded-[11px] bg-muted p-[3px] text-muted-foreground">
            {KONSUMEN_TABS.filter((tab) => !tab.requires || can(...tab.requires)).map((tab) => (
              <NavLink
                key={tab.path}
                to={`${basePath}/${tab.path}`}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-[38px] items-center justify-center whitespace-nowrap rounded-[8px] px-4 py-1.5 text-[13.5px] font-bold transition-all",
                    isActive ? "bg-card text-foreground shadow-sm" : "hover:text-foreground"
                  )
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>

          <PageHeaderLevelContext.Provider value={2}>
            <Outlet />
          </PageHeaderLevelContext.Provider>
        </>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Halaman ini khusus unit Konsumen/Toko
          </CardContent>
        </Card>
      )}
    </div>
  );
}
