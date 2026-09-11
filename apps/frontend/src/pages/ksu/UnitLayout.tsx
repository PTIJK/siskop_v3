import { NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CooperativeType, type CooperativeUnit } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UNIT_TYPE_ICON, UNIT_TYPE_LABEL } from "@/lib/unitTypeMeta";
import { cn } from "@/lib/utils";

/** Tabs shown only for a KONSUMEN-type unit — extend this array to add another, the isKonsumen gate below wraps all of them alike. */
const KONSUMEN_TABS = [
  { path: "products", label: "Produk" },
  { path: "stock", label: "Stok" },
  { path: "pos", label: "POS" },
  { path: "ppob", label: "PPOB" }
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

  const {
    data: unit,
    isPending,
    isError
  } = useQuery({
    queryKey: ["config", "units"],
    queryFn: () => apiFetch<CooperativeUnit[]>("/config/units"),
    select: (units) => units.find((u) => u.id === unitId)
  });

  if (isPending) return <PageLoading />;

  if (isError || !unit) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">Unit usaha tidak ditemukan</CardContent>
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
        breadcrumb={[{ label: "Unit Usaha", href: "/ksu/units" }, { label: unit.name }]}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Icon className="h-3.5 w-3.5" />
              {UNIT_TYPE_LABEL[unit.type]}
            </Badge>
            {!unit.isActive && <Badge variant="secondary">Nonaktif</Badge>}
          </div>
        }
      />

      {isKonsumen ? (
        <>
          <nav className="inline-flex h-10 items-center justify-center gap-1 rounded-md bg-muted p-1 text-muted-foreground">
            {KONSUMEN_TABS.map((tab) => (
              <NavLink
                key={tab.path}
                to={`${basePath}/${tab.path}`}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all",
                    isActive ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
                  )
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>

          <Outlet />
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
