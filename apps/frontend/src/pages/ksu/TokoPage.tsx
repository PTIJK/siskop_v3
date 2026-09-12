import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CooperativeUnit } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { UnitCard } from "@/components/ksu/UnitCard";
import { CreateUnitDialog } from "@/components/ksu/CreateUnitDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Store, Plus } from "lucide-react";

// Same `/config/units` data + `["config", "units"]` query key as
// pages/ksu/UnitsPage.tsx and pages/config/UnitsTab.tsx, filtered client-side
// to KONSUMEN-type units — no parallel backend endpoint, unit type stays a
// filter rather than a separate model (CLAUDE.md rule 2b). Not gated by
// RequireMultiUnit like UnitsPage/ConsolidatedReportPage: a tenant whose only
// unit is a Toko still needs a nav path into it (see Sidebar.tsx's Unit Usaha
// comment), so this route must stay reachable for single-unit tenants too.
export function TokoPage() {
  const { can } = usePermissions();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["config", "units"],
    queryFn: () => apiFetch<CooperativeUnit[]>("/config/units")
  });

  const tokoUnits = data?.filter((unit) => unit.type === "KONSUMEN") ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Toko"
        description="Kelola unit usaha toko (konsumen)"
        actions={
          can("config", "update") && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Toko
            </Button>
          )
        }
      />

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof ApiRequestError ? error.message : "Gagal memuat unit toko"}
          </CardContent>
        </Card>
      ) : tokoUnits.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Store className="h-10 w-10" />
            <p className="text-sm">Belum ada unit toko</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tokoUnits.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      )}

      <CreateUnitDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultType="KONSUMEN" />
    </div>
  );
}
