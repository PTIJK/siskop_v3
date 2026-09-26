import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Market, Stall, StallKind, StallStatus } from "@siskop/types";
import { apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

const marketSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  address: z.string().optional()
});
type MarketFormValues = z.infer<typeof marketSchema>;

const stallSchema = z.object({
  code: z.string().min(1, "Kode kios wajib diisi"),
  block: z.string().optional(),
  kind: z.enum(["KIOS", "LOS", "LAPAK"]),
  // Kept as a plain string (not z.coerce.number(), which turns "" into 0
  // before `.optional()` can see it) so the schema's input/output types
  // match — a zod `.transform()` here would give useForm's TFieldValues a
  // different shape than what register()/setValue() produce, which
  // zodResolver's types reject. Converted to a number in submitStall
  // instead, same pattern NewLoanPage uses for termMonths/installmentCount.
  areaM2: z.string().optional().refine((v) => !v || Number(v) > 0, "Luas harus lebih dari 0"),
  status: z.enum(["AVAILABLE", "OCCUPIED", "INACTIVE"])
});
type StallFormValues = z.infer<typeof stallSchema>;

const STALL_KIND_LABEL: Record<StallKind, string> = { KIOS: "Kios", LOS: "Los", LAPAK: "Lapak" };
const STALL_STATUS_LABEL: Record<StallStatus, string> = { AVAILABLE: "Kosong", OCCUPIED: "Terisi", INACTIVE: "Nonaktif" };
const STALL_STATUS_VARIANT: Record<StallStatus, "outline" | "default" | "secondary"> = {
  AVAILABLE: "outline",
  OCCUPIED: "default",
  INACTIVE: "secondary"
};

export function MarketPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [blockFilter, setBlockFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StallStatus | "ALL">("ALL");
  const [marketDialogOpen, setMarketDialogOpen] = useState(false);
  const [stallDialogOpen, setStallDialogOpen] = useState(false);
  const [editingStall, setEditingStall] = useState<Stall | null>(null);
  const [apiError, setApiError] = useState("");

  const { data: markets, isPending: marketsPending, refetch: refetchMarkets } = useQuery({
    queryKey: ["market", "markets"],
    queryFn: () => apiFetch<Market[]>("/market/markets")
  });

  useEffect(() => {
    if (!selectedMarketId && markets && markets.length > 0) setSelectedMarketId(markets[0]!.id);
  }, [markets, selectedMarketId]);

  const stallsQuery = useQuery({
    queryKey: ["market", "stalls", selectedMarketId, blockFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedMarketId) params.set("marketId", selectedMarketId);
      if (blockFilter) params.set("block", blockFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      return apiFetch<Stall[]>(`/market/stalls?${params.toString()}`);
    },
    enabled: !!selectedMarketId
  });

  const marketForm = useForm<MarketFormValues>({ resolver: zodResolver(marketSchema) });
  const stallForm = useForm<StallFormValues>({ resolver: zodResolver(stallSchema) });
  const stallValues = stallForm.watch();

  const openCreateMarket = () => {
    setApiError("");
    marketForm.reset({ name: "", address: "" });
    setMarketDialogOpen(true);
  };

  const submitMarket = async (values: MarketFormValues) => {
    setApiError("");
    try {
      await apiPost("/market/markets", values);
      toast({ title: "Pasar ditambahkan" });
      setMarketDialogOpen(false);
      void refetchMarkets();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const openCreateStall = () => {
    setApiError("");
    setEditingStall(null);
    stallForm.reset({ code: "", block: blockFilter || "", kind: "KIOS", status: "AVAILABLE" });
    setStallDialogOpen(true);
  };

  const openEditStall = (stall: Stall) => {
    setApiError("");
    setEditingStall(stall);
    stallForm.reset({
      code: stall.code,
      block: stall.block ?? "",
      kind: stall.kind,
      areaM2: stall.areaM2 ?? "",
      status: stall.status
    });
    setStallDialogOpen(true);
  };

  const submitStall = async (values: StallFormValues) => {
    if (!selectedMarketId) return;
    setApiError("");
    const payload = { ...values, areaM2: values.areaM2 ? Number(values.areaM2) : undefined };
    try {
      if (editingStall) {
        await apiPut(`/market/stalls/${editingStall.id}`, payload);
        toast({ title: "Kios diperbarui" });
      } else {
        await apiPost("/market/stalls", { ...payload, marketId: selectedMarketId });
        toast({ title: "Kios ditambahkan" });
      }
      setStallDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["market", "stalls"] });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const columns: ColumnDef<Stall>[] = [
    { header: "Kode", accessorKey: "code" },
    { header: "Blok", cell: ({ row }) => row.original.block ?? "-" },
    { header: "Jenis", cell: ({ row }) => STALL_KIND_LABEL[row.original.kind] },
    { header: "Luas (m²)", cell: ({ row }) => row.original.areaM2 ?? "-" },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STALL_STATUS_VARIANT[row.original.status]}>{STALL_STATUS_LABEL[row.original.status]}</Badge>
      )
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("market", "update") && (
          <Button size="sm" variant="outline" onClick={() => openEditStall(row.original)}>
            Edit
          </Button>
        )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Pasar" breadcrumb={[{ label: "Pasar" }]} />

      <div className="flex flex-wrap items-center gap-2">
        {marketsPending && <p className="text-sm text-muted-foreground">Memuat pasar...</p>}
        {markets?.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelectedMarketId(m.id)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              selectedMarketId === m.id ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-muted"
            )}
          >
            {m.name}
          </button>
        ))}
        {can("market", "create") && (
          <Button size="sm" variant="outline" onClick={openCreateMarket}>
            <Plus className="mr-2 h-3.5 w-3.5" /> Tambah Pasar
          </Button>
        )}
      </div>

      {markets && markets.length === 0 && !marketsPending && (
        <p className="text-sm text-muted-foreground">Belum ada pasar. Tambahkan pasar untuk mulai mengelola kios.</p>
      )}

      {selectedMarketId && (
        <DataTable
          columns={columns}
          data={stallsQuery.data ?? []}
          isLoading={stallsQuery.isPending}
          isError={stallsQuery.isError}
          errorMessage={stallsQuery.error instanceof Error ? stallsQuery.error.message : undefined}
          onRetry={stallsQuery.refetch}
          emptyMessage="Belum ada kios di pasar ini"
          search={{ value: blockFilter, onChange: setBlockFilter, placeholder: "Filter blok..." }}
          headerActions={
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={(v: StallStatus | "ALL") => setStatusFilter(v)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua Status</SelectItem>
                  <SelectItem value="AVAILABLE">Kosong</SelectItem>
                  <SelectItem value="OCCUPIED">Terisi</SelectItem>
                  <SelectItem value="INACTIVE">Nonaktif</SelectItem>
                </SelectContent>
              </Select>
              {can("market", "create") && (
                <Button size="sm" onClick={openCreateStall}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Tambah Kios
                </Button>
              )}
            </div>
          }
        />
      )}

      <Dialog open={marketDialogOpen} onOpenChange={setMarketDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Pasar</DialogTitle>
          </DialogHeader>
          <form onSubmit={marketForm.handleSubmit(submitMarket)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Nama Pasar *</Label>
              <Input placeholder="Pasar Induk" {...marketForm.register("name")} />
              {marketForm.formState.errors.name && (
                <p className="text-xs text-destructive">{marketForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Alamat</Label>
              <Input {...marketForm.register("address")} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setMarketDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={marketForm.formState.isSubmitting}>
                {marketForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={stallDialogOpen} onOpenChange={setStallDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingStall ? "Edit Kios" : "Tambah Kios"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={stallForm.handleSubmit(submitStall)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Kode Kios *</Label>
                <Input placeholder="A-01" {...stallForm.register("code")} />
                {stallForm.formState.errors.code && (
                  <p className="text-xs text-destructive">{stallForm.formState.errors.code.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Blok</Label>
                <Input placeholder="A" {...stallForm.register("block")} />
              </div>
              <div className="space-y-1.5">
                <Label>Jenis *</Label>
                <Select value={stallValues.kind} onValueChange={(v: StallFormValues["kind"]) => stallForm.setValue("kind", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KIOS">Kios</SelectItem>
                    <SelectItem value="LOS">Los</SelectItem>
                    <SelectItem value="LAPAK">Lapak</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Luas (m²)</Label>
                <Input type="number" step="0.01" {...stallForm.register("areaM2")} />
                {stallForm.formState.errors.areaM2 && (
                  <p className="text-xs text-destructive">{stallForm.formState.errors.areaM2.message}</p>
                )}
              </div>
              {editingStall && (
                <div className="col-span-2 space-y-1.5">
                  <Label>Status *</Label>
                  <Select
                    value={stallValues.status}
                    onValueChange={(v: StallFormValues["status"]) => stallForm.setValue("status", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AVAILABLE">Kosong</SelectItem>
                      <SelectItem value="OCCUPIED">Terisi</SelectItem>
                      <SelectItem value="INACTIVE">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setStallDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={stallForm.formState.isSubmitting}>
                {stallForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
