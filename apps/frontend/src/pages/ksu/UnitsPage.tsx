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
import { Building2, Plus } from "lucide-react";

// Same `/config/units` data + `["config", "units"]` query key as
// pages/config/UnitsTab.tsx (the general admin Config > Units tab) — this is
// a distinct, more prominent top-level surface for KSU (multi-unit) tenants,
// not a second source of truth. Sharing the query key also means creating a
// unit here keeps the Config tab's cache in sync, and vice versa.
export function UnitsPage() {
  const { can } = usePermissions();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["config", "units"],
    queryFn: () => apiFetch<CooperativeUnit[]>("/config/units")
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unit Usaha"
        description="Kelola unit usaha koperasi serba usaha (KSU)"
        actions={
          can("config", "update") && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Unit
            </Button>
          )
        }
      />

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof ApiRequestError ? error.message : "Gagal memuat unit usaha"}
          </CardContent>
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Building2 className="h-10 w-10" />
            <p className="text-sm">Belum ada unit usaha</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      )}

      <CreateUnitDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
