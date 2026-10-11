import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type {
  Charge,
  InstallmentStatus,
  LevyRate,
  Market,
  Stall,
  StallContractSummary,
  StallKind,
  StallStatus
} from "@siskop/types";
import { apiFetch, apiFetchPage, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { formatRupiah, formatTanggalIndonesia } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const contractSchema = z.object({
  stallId: z.string().min(1, "Pilih kios"),
  startDate: z.string().min(1, "Tanggal mulai wajib diisi"),
  rentAmount: z.string().min(1, "Nilai sewa wajib diisi").refine((v) => Number(v) > 0, "Nilai sewa harus lebih dari 0"),
  rentPeriod: z.enum(["MONTHLY", "YEARLY"])
});
type ContractFormValues = z.infer<typeof contractSchema>;

const levyRateSchema = z.object({
  stallKind: z.enum(["KIOS", "LOS", "LAPAK"]),
  name: z.string().min(1, "Nama tarif wajib diisi"),
  amount: z.string().min(1, "Nominal wajib diisi").refine((v) => Number(v) > 0, "Nominal harus lebih dari 0"),
  period: z.enum(["DAILY", "MONTHLY", "YEARLY"])
});
type LevyRateFormValues = z.infer<typeof levyRateSchema>;

const payChargeSchema = z.object({
  amount: z.string().min(1, "Nominal wajib diisi").refine((v) => Number(v) > 0, "Nominal harus lebih dari 0"),
  note: z.string().optional()
});
type PayChargeFormValues = z.infer<typeof payChargeSchema>;

interface MemberResult {
  id: string;
  memberId: string;
  fullName: string;
}

const STALL_KIND_LABEL: Record<StallKind, string> = { KIOS: "Kios", LOS: "Los", LAPAK: "Lapak" };
const STALL_STATUS_LABEL: Record<StallStatus, string> = { AVAILABLE: "Kosong", OCCUPIED: "Terisi", INACTIVE: "Nonaktif" };
const STALL_STATUS_VARIANT: Record<StallStatus, "outline" | "default" | "secondary"> = {
  AVAILABLE: "outline",
  OCCUPIED: "default",
  INACTIVE: "secondary"
};
const CHARGE_STATUS_LABEL: Record<InstallmentStatus, string> = { UNPAID: "Belum Bayar", PARTIAL: "Sebagian", PAID: "Lunas" };
const CHARGE_STATUS_VARIANT: Record<InstallmentStatus, "outline" | "default" | "secondary"> = {
  UNPAID: "outline",
  PARTIAL: "secondary",
  PAID: "default"
};
const PERIOD_LABEL: Record<"DAILY" | "MONTHLY" | "YEARLY", string> = { DAILY: "Harian", MONTHLY: "Bulanan", YEARLY: "Tahunan" };

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

  const stallColumns: ColumnDef<Stall>[] = [
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

  // ── Kontrak sewa ────────────────────────────────────────────────────────
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [endingContractId, setEndingContractId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<MemberResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null);

  const contractsQuery = useQuery({
    queryKey: ["market", "contracts"],
    queryFn: () => apiFetch<StallContractSummary[]>("/market/contracts")
  });
  const marketContracts = (contractsQuery.data ?? []).filter((c) => c.marketId === selectedMarketId);

  const contractForm = useForm<ContractFormValues>({ resolver: zodResolver(contractSchema) });
  const contractValues = contractForm.watch();

  const openCreateContract = () => {
    setApiError("");
    setSelectedMember(null);
    setMemberSearch("");
    setMemberResults([]);
    contractForm.reset({ stallId: "", startDate: new Date().toISOString().slice(0, 10), rentAmount: "", rentPeriod: "MONTHLY" });
    setContractDialogOpen(true);
  };

  const searchMembers = async (q: string) => {
    if (q.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    const { items } = await apiFetchPage<MemberResult[]>(`/members?search=${encodeURIComponent(q)}&limit=5`);
    setMemberResults(items);
  };

  const submitContract = async (values: ContractFormValues) => {
    if (!selectedMember) return;
    setApiError("");
    try {
      await apiPost("/market/contracts", { ...values, memberId: selectedMember.id, rentAmount: Number(values.rentAmount) });
      toast({ title: "Kontrak sewa ditambahkan" });
      setContractDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["market", "contracts"] });
      void queryClient.invalidateQueries({ queryKey: ["market", "stalls"] });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const endContract = async () => {
    if (!endingContractId) return;
    try {
      await apiPost(`/market/contracts/${endingContractId}/end`, {});
      toast({ title: "Kontrak diselesaikan" });
      void queryClient.invalidateQueries({ queryKey: ["market", "contracts"] });
      void queryClient.invalidateQueries({ queryKey: ["market", "stalls"] });
    } catch (err) {
      toast({
        title: "Gagal",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    } finally {
      setEndingContractId(null);
    }
  };

  const contractColumns: ColumnDef<StallContractSummary>[] = [
    { header: "Kios", accessorKey: "stallCode" },
    { header: "Anggota", accessorKey: "memberName" },
    { header: "Nilai Sewa", cell: ({ row }) => formatRupiah(row.original.rentAmount) },
    { header: "Periode", cell: ({ row }) => PERIOD_LABEL[row.original.rentPeriod] },
    { header: "Mulai", cell: ({ row }) => formatTanggalIndonesia(row.original.startDate) },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Aktif" : "Selesai"}</Badge>
      )
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        row.original.isActive &&
        can("market", "update") && (
          <Button size="sm" variant="outline" onClick={() => setEndingContractId(row.original.id)}>
            Selesaikan
          </Button>
        )
    }
  ];

  // ── Tarif retribusi ─────────────────────────────────────────────────────
  const [levyDialogOpen, setLevyDialogOpen] = useState(false);
  const [editingLevyRate, setEditingLevyRate] = useState<LevyRate | null>(null);

  const levyRatesQuery = useQuery({
    queryKey: ["market", "levy-rates", selectedMarketId],
    queryFn: () => apiFetch<LevyRate[]>(`/market/levy-rates?marketId=${selectedMarketId}`),
    enabled: !!selectedMarketId
  });

  const levyRateForm = useForm<LevyRateFormValues>({ resolver: zodResolver(levyRateSchema) });
  const levyRateValues = levyRateForm.watch();

  const openCreateLevyRate = () => {
    setApiError("");
    setEditingLevyRate(null);
    levyRateForm.reset({ stallKind: "KIOS", name: "", amount: "", period: "DAILY" });
    setLevyDialogOpen(true);
  };

  const openEditLevyRate = (rate: LevyRate) => {
    setApiError("");
    setEditingLevyRate(rate);
    levyRateForm.reset({ stallKind: rate.stallKind, name: rate.name, amount: rate.amount, period: rate.period });
    setLevyDialogOpen(true);
  };

  const submitLevyRate = async (values: LevyRateFormValues) => {
    if (!selectedMarketId) return;
    setApiError("");
    const payload = { ...values, amount: Number(values.amount) };
    try {
      if (editingLevyRate) {
        await apiPut(`/market/levy-rates/${editingLevyRate.id}`, payload);
        toast({ title: "Tarif retribusi diperbarui" });
      } else {
        await apiPost("/market/levy-rates", { ...payload, marketId: selectedMarketId });
        toast({ title: "Tarif retribusi ditambahkan" });
      }
      setLevyDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["market", "levy-rates"] });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const toggleLevyRateActive = async (rate: LevyRate) => {
    try {
      await apiPut(`/market/levy-rates/${rate.id}`, { isActive: !rate.isActive });
      toast({ title: rate.isActive ? "Tarif dinonaktifkan" : "Tarif diaktifkan" });
      void queryClient.invalidateQueries({ queryKey: ["market", "levy-rates"] });
    } catch (err) {
      toast({
        title: "Gagal",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const levyRateColumns: ColumnDef<LevyRate>[] = [
    { header: "Jenis Kios", cell: ({ row }) => STALL_KIND_LABEL[row.original.stallKind] },
    { header: "Nama Tarif", accessorKey: "name" },
    { header: "Nominal", cell: ({ row }) => formatRupiah(row.original.amount) },
    { header: "Periode", cell: ({ row }) => PERIOD_LABEL[row.original.period] },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Aktif" : "Nonaktif"}</Badge>
      )
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("market", "update") && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => openEditLevyRate(row.original)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => toggleLevyRateActive(row.original)}>
              {row.original.isActive ? "Nonaktifkan" : "Aktifkan"}
            </Button>
          </div>
        )
    }
  ];

  // ── Tagihan ─────────────────────────────────────────────────────────────
  const [chargeBlockFilter, setChargeBlockFilter] = useState("");
  const [chargeStatusFilter, setChargeStatusFilter] = useState<InstallmentStatus | "ALL">("ALL");
  const [payingCharge, setPayingCharge] = useState<Charge | null>(null);

  const chargesQuery = useQuery({
    queryKey: ["market", "charges", selectedMarketId, chargeBlockFilter, chargeStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedMarketId) params.set("marketId", selectedMarketId);
      if (chargeBlockFilter) params.set("block", chargeBlockFilter);
      if (chargeStatusFilter !== "ALL") params.set("status", chargeStatusFilter);
      return apiFetch<Charge[]>(`/market/charges?${params.toString()}`);
    },
    enabled: !!selectedMarketId
  });

  const payChargeForm = useForm<PayChargeFormValues>({ resolver: zodResolver(payChargeSchema) });

  const openPayCharge = (charge: Charge) => {
    setApiError("");
    setPayingCharge(charge);
    const remaining = Number(charge.amount) - Number(charge.paidAmount);
    payChargeForm.reset({ amount: String(remaining), note: "" });
  };

  const submitPayCharge = async (values: PayChargeFormValues) => {
    if (!payingCharge) return;
    setApiError("");
    try {
      await apiPost(`/market/charges/${payingCharge.id}/pay`, { ...values, amount: Number(values.amount) });
      toast({ title: "Pembayaran tercatat" });
      setPayingCharge(null);
      void queryClient.invalidateQueries({ queryKey: ["market", "charges"] });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const chargeColumns: ColumnDef<Charge>[] = [
    { header: "Kios", cell: ({ row }) => `${row.original.stallCode}${row.original.block ? ` (${row.original.block})` : ""}` },
    { header: "Anggota", accessorKey: "memberName" },
    { header: "Jenis", cell: ({ row }) => (row.original.kind === "SEWA" ? "Sewa" : "Retribusi") },
    { header: "Jatuh Tempo", cell: ({ row }) => formatTanggalIndonesia(row.original.dueDate) },
    { header: "Nominal", cell: ({ row }) => formatRupiah(row.original.amount) },
    { header: "Terbayar", cell: ({ row }) => formatRupiah(row.original.paidAmount) },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={CHARGE_STATUS_VARIANT[row.original.status]}>{CHARGE_STATUS_LABEL[row.original.status]}</Badge>
      )
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        row.original.status !== "PAID" &&
        can("market", "update") && (
          <Button size="sm" onClick={() => openPayCharge(row.original)}>
            Bayar
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
        <Tabs defaultValue="kios">
          <TabsList>
            <TabsTrigger value="kios">Kios</TabsTrigger>
            <TabsTrigger value="kontrak">Kontrak Sewa</TabsTrigger>
            <TabsTrigger value="levy-rates">Tarif Retribusi</TabsTrigger>
            <TabsTrigger value="charges">Tagihan</TabsTrigger>
          </TabsList>

          <TabsContent value="kios" className="mt-4">
            <DataTable
              columns={stallColumns}
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
          </TabsContent>

          <TabsContent value="kontrak" className="mt-4">
            <DataTable
              columns={contractColumns}
              data={marketContracts}
              isLoading={contractsQuery.isPending}
              isError={contractsQuery.isError}
              errorMessage={contractsQuery.error instanceof Error ? contractsQuery.error.message : undefined}
              onRetry={contractsQuery.refetch}
              emptyMessage="Belum ada kontrak sewa di pasar ini"
              headerActions={
                can("market", "create") && (
                  <Button size="sm" onClick={openCreateContract}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Tambah Kontrak
                  </Button>
                )
              }
            />
          </TabsContent>

          <TabsContent value="levy-rates" className="mt-4">
            <DataTable
              columns={levyRateColumns}
              data={levyRatesQuery.data ?? []}
              isLoading={levyRatesQuery.isPending}
              isError={levyRatesQuery.isError}
              errorMessage={levyRatesQuery.error instanceof Error ? levyRatesQuery.error.message : undefined}
              onRetry={levyRatesQuery.refetch}
              emptyMessage="Belum ada tarif retribusi untuk pasar ini"
              headerActions={
                can("market", "create") && (
                  <Button size="sm" onClick={openCreateLevyRate}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Tambah Tarif
                  </Button>
                )
              }
            />
          </TabsContent>

          <TabsContent value="charges" className="mt-4">
            <DataTable
              columns={chargeColumns}
              data={chargesQuery.data ?? []}
              isLoading={chargesQuery.isPending}
              isError={chargesQuery.isError}
              errorMessage={chargesQuery.error instanceof Error ? chargesQuery.error.message : undefined}
              onRetry={chargesQuery.refetch}
              emptyMessage="Belum ada tagihan untuk pasar ini"
              search={{ value: chargeBlockFilter, onChange: setChargeBlockFilter, placeholder: "Filter blok..." }}
              headerActions={
                <Select value={chargeStatusFilter} onValueChange={(v: InstallmentStatus | "ALL") => setChargeStatusFilter(v)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Status</SelectItem>
                    <SelectItem value="UNPAID">Belum Bayar</SelectItem>
                    <SelectItem value="PARTIAL">Sebagian</SelectItem>
                    <SelectItem value="PAID">Lunas</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </TabsContent>
        </Tabs>
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

      <Dialog open={contractDialogOpen} onOpenChange={setContractDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Kontrak Sewa</DialogTitle>
          </DialogHeader>
          <form onSubmit={contractForm.handleSubmit(submitContract)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Kios *</Label>
              <Select value={contractValues.stallId} onValueChange={(v: string) => contractForm.setValue("stallId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kios" />
                </SelectTrigger>
                <SelectContent>
                  {(stallsQuery.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} {s.block ? `(${s.block})` : ""} — {STALL_STATUS_LABEL[s.status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {contractForm.formState.errors.stallId && (
                <p className="text-xs text-destructive">{contractForm.formState.errors.stallId.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Anggota (Pedagang) *</Label>
              {selectedMember ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{selectedMember.fullName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{selectedMember.memberId}</p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedMember(null)}>
                    Ganti
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Cari nama atau NIK anggota..."
                    value={memberSearch}
                    onChange={(e) => {
                      setMemberSearch(e.target.value);
                      void searchMembers(e.target.value);
                    }}
                  />
                  {memberResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-md">
                      {memberResults.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setSelectedMember(m);
                            setMemberResults([]);
                            setMemberSearch("");
                          }}
                        >
                          <span>{m.fullName}</span>
                          <span className="font-mono text-xs text-muted-foreground">{m.memberId}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Tanggal Mulai *</Label>
                <Input type="date" {...contractForm.register("startDate")} />
              </div>
              <div className="space-y-1.5">
                <Label>Periode *</Label>
                <Select
                  value={contractValues.rentPeriod}
                  onValueChange={(v: ContractFormValues["rentPeriod"]) => contractForm.setValue("rentPeriod", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Bulanan</SelectItem>
                    <SelectItem value="YEARLY">Tahunan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Nilai Sewa (Rp) *</Label>
                <Input type="number" placeholder="500000" {...contractForm.register("rentAmount")} />
                {contractForm.formState.errors.rentAmount && (
                  <p className="text-xs text-destructive">{contractForm.formState.errors.rentAmount.message}</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setContractDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={contractForm.formState.isSubmitting || !selectedMember}>
                {contractForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!endingContractId}
        onOpenChange={(open) => !open && setEndingContractId(null)}
        title="Selesaikan Kontrak"
        description="Kios akan menjadi kosong dan dapat disewakan ke pedagang lain. Lanjutkan?"
        confirmLabel="Selesaikan"
        onConfirm={endContract}
      />

      <Dialog open={levyDialogOpen} onOpenChange={setLevyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLevyRate ? "Edit Tarif Retribusi" : "Tambah Tarif Retribusi"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={levyRateForm.handleSubmit(submitLevyRate)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Jenis Kios *</Label>
              <Select
                value={levyRateValues.stallKind}
                onValueChange={(v: LevyRateFormValues["stallKind"]) => levyRateForm.setValue("stallKind", v)}
              >
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
              <Label>Nama Tarif *</Label>
              <Input placeholder="Kebersihan" {...levyRateForm.register("name")} />
              {levyRateForm.formState.errors.name && (
                <p className="text-xs text-destructive">{levyRateForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nominal (Rp) *</Label>
                <Input type="number" placeholder="5000" {...levyRateForm.register("amount")} />
                {levyRateForm.formState.errors.amount && (
                  <p className="text-xs text-destructive">{levyRateForm.formState.errors.amount.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Periode *</Label>
                <Select
                  value={levyRateValues.period}
                  onValueChange={(v: LevyRateFormValues["period"]) => levyRateForm.setValue("period", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">Harian</SelectItem>
                    <SelectItem value="MONTHLY">Bulanan</SelectItem>
                    <SelectItem value="YEARLY">Tahunan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setLevyDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={levyRateForm.formState.isSubmitting}>
                {levyRateForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payingCharge} onOpenChange={(open) => !open && setPayingCharge(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bayar Tagihan</DialogTitle>
          </DialogHeader>
          {payingCharge && (
            <form onSubmit={payChargeForm.handleSubmit(submitPayCharge)} className="space-y-4">
              {apiError && <FormError error={apiError} />}
              <div className="rounded-md border bg-muted p-3 text-sm">
                <p className="font-medium">{payingCharge.memberName}</p>
                <p className="text-muted-foreground">
                  {payingCharge.stallCode} — {payingCharge.kind === "SEWA" ? "Sewa" : "Retribusi"}
                </p>
                <p className="mt-1">
                  Sisa tagihan:{" "}
                  <span className="font-semibold">
                    {formatRupiah(Number(payingCharge.amount) - Number(payingCharge.paidAmount))}
                  </span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Nominal Bayar (Rp) *</Label>
                <Input type="number" {...payChargeForm.register("amount")} />
                {payChargeForm.formState.errors.amount && (
                  <p className="text-xs text-destructive">{payChargeForm.formState.errors.amount.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Catatan</Label>
                <Input {...payChargeForm.register("note")} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setPayingCharge(null)}>
                  Batal
                </Button>
                <Button type="submit" disabled={payChargeForm.formState.isSubmitting}>
                  {payChargeForm.formState.isSubmitting ? "Menyimpan..." : "Bayar"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
