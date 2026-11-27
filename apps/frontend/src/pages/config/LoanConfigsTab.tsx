import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { LoanConfig } from "@siskop/types";
import { apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useEntitlements } from "@/hooks/useEntitlements";
import { QuotaBadge } from "@/components/shared/QuotaBadge";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

const MAX_ANNUAL_RATE = 24;

const schema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN", "HARIAN"]),
  rate: z.coerce.number().min(0).max(MAX_ANNUAL_RATE, `Maksimal ${MAX_ANNUAL_RATE}% per tahun`),
  maxTermMonths: z.coerce.number().int().min(1).max(360),
  installmentFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  maxInstallments: z.coerce.number().int().min(1).optional()
});
type FormValues = z.infer<typeof schema>;

export function LoanConfigsTab({ onSetupSaved }: { onSetupSaved?: () => Promise<void> }) {
  const { can } = usePermissions();
  const { quota } = useEntitlements();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LoanConfig | null>(null);
  const [apiError, setApiError] = useState("");

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["config", "loan-configs"],
    queryFn: () => apiFetch<LoanConfig[]>("/loans/configs")
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const values = watch();
  const rateField = register("rate");

  const openCreate = () => {
    setEditing(null);
    setApiError("");
    reset({ name: "", type: "KONVENSIONAL", rateType: "BUNGA", rate: 0, maxTermMonths: 12, installmentFrequency: "MONTHLY" });
    setDialogOpen(true);
  };

  const openEdit = (config: LoanConfig) => {
    setEditing(config);
    setApiError("");
    reset({
      name: config.name,
      type: config.type,
      rateType: config.rateType,
      rate: Number(config.rate),
      maxTermMonths: config.maxTermMonths,
      installmentFrequency: config.installmentFrequency,
      maxInstallments: config.maxInstallments ?? undefined
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    try {
      if (editing) {
        await apiPut(`/loans/configs/${editing.id}`, values);
        toast({ title: "Konfigurasi pinjaman diperbarui" });
      } else {
        await apiPost("/loans/configs", values);
        toast({ title: "Konfigurasi pinjaman ditambahkan" });
      }
      setDialogOpen(false);
      void refetch();
      if (onSetupSaved) await onSetupSaved();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const columns: ColumnDef<LoanConfig>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Jenis", cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge> },
    { header: "Tipe Imbal Hasil", accessorKey: "rateType" },
    { header: "Rate (%)", cell: ({ row }) => Number(row.original.rate).toString() },
    {
      header: "Frekuensi Cicilan",
      cell: ({ row }) =>
        ({ DAILY: "Harian", WEEKLY: "Mingguan", MONTHLY: "Bulanan" })[row.original.installmentFrequency]
    },
    {
      header: "Maks. Tenor",
      cell: ({ row }) =>
        row.original.installmentFrequency === "MONTHLY"
          ? `${row.original.maxTermMonths} bulan`
          : row.original.maxInstallments
            ? `${row.original.maxInstallments} cicilan`
            : "—"
    },
    {
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Aktif" : "Nonaktif"}</Badge>
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("config", "update") && (
          <Button size="sm" variant="outline" onClick={() => openEdit(row.original)}>
            Edit
          </Button>
        )
    }
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        emptyMessage="Belum ada konfigurasi pinjaman"
        headerActions={
          can("config", "update") && (
            <div className="flex items-center gap-3">
            <QuotaBadge hint={quota("loanTypes")} noun="jenis" />
            <Button data-setup-target={onSetupSaved ? "add" : undefined} onClick={openCreate} className={onSetupSaved ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : undefined} disabled={quota("loanTypes")?.blocked}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Pinjaman
            </Button>
            </div>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-setup-dialog={onSetupSaved ? "" : undefined} className="max-w-[560px] gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-5 pr-14 text-left sm:px-6 sm:pr-14">
            <DialogTitle>{editing ? "Edit Konfigurasi Pinjaman" : "Tambah Konfigurasi Pinjaman"}</DialogTitle>
            <DialogDescription>Atur imbal hasil tahunan, frekuensi cicilan, dan batas tenor produk.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4 px-5 py-5 sm:px-6">
              {apiError && <FormError error={apiError} />}

              <div className="space-y-1.5">
                <Label htmlFor="config-name">Nama pinjaman</Label>
                <Input id="config-name" placeholder="KUR Mikro" {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div className="grid grid-cols-1 gap-x-4 gap-y-5 min-[440px]:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="config-type">Jenis</Label>
                  <Select value={values.type} onValueChange={(v: FormValues["type"]) => setValue("type", v)}>
                    <SelectTrigger id="config-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KONVENSIONAL">Konvensional</SelectItem>
                      <SelectItem value="SYARIAH">Syariah</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="config-return-type">Tipe imbal hasil</Label>
                  <Select value={values.rateType} onValueChange={(v: FormValues["rateType"]) => setValue("rateType", v)}>
                    <SelectTrigger id="config-return-type" className="gap-2 text-left [&>span]:min-w-0 [&>svg]:shrink-0">
                      <SelectValue>
                        {{ BUNGA: "Bunga", BAGI_HASIL: "Bagi hasil", MARGIN: "Margin", HARIAN: "Bunga harian" }[values.rateType]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUNGA">Bunga (Anuitas/Menurun)</SelectItem>
                      <SelectItem value="BAGI_HASIL">Bagi Hasil</SelectItem>
                      <SelectItem value="MARGIN">Margin (Flat)</SelectItem>
                      <SelectItem value="HARIAN">Bunga Harian (Flat)</SelectItem>
                    </SelectContent>
                  </Select>
                  {values.rateType && values.rateType !== "BUNGA" && (
                    <p className="text-xs text-muted-foreground">
                      Imbal hasil dihitung dari pokok awal sepanjang tenor (flat).
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="config-rate">Imbal hasil per tahun (%)</Label>
                  <Input
                    {...rateField}
                    id="config-rate"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={MAX_ANNUAL_RATE}
                    step="0.01"
                    aria-invalid={Boolean(errors.rate)}
                    aria-describedby="config-rate-hint"
                    onChange={(event) => {
                      if (event.currentTarget.valueAsNumber > MAX_ANNUAL_RATE) {
                        event.currentTarget.value = String(MAX_ANNUAL_RATE);
                      }
                      void rateField.onChange(event);
                    }}
                  />
                  <p id="config-rate-hint" className={errors.rate ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                    {errors.rate?.message ?? `Maksimal ${MAX_ANNUAL_RATE}% per tahun.`}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="config-frequency">Frekuensi cicilan</Label>
                  <Select
                    value={values.installmentFrequency}
                    onValueChange={(v: FormValues["installmentFrequency"]) => setValue("installmentFrequency", v)}
                  >
                    <SelectTrigger id="config-frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">Bulanan</SelectItem>
                      <SelectItem value="WEEKLY">Mingguan</SelectItem>
                      <SelectItem value="DAILY">Harian</SelectItem>
                    </SelectContent>
                  </Select>
                  {values.installmentFrequency && values.installmentFrequency !== "MONTHLY" && values.rateType === "BUNGA" && (
                    <p className="text-xs text-destructive">
                      Anuitas (Bunga) hanya tersedia untuk frekuensi bulanan — pilih Margin atau Bunga Harian.
                    </p>
                  )}
                </div>

                {values.installmentFrequency === "MONTHLY" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="config-term">Maks. tenor (bulan)</Label>
                    <Input id="config-term" type="number" {...register("maxTermMonths")} />
                    {errors.maxTermMonths && <p className="text-xs text-destructive">{errors.maxTermMonths.message}</p>}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="config-installments">Maks. jumlah cicilan</Label>
                    <Input id="config-installments" type="number" {...register("maxInstallments")} />
                    {errors.maxInstallments && <p className="text-xs text-destructive">{errors.maxInstallments.message}</p>}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter className="gap-2 border-t border-border bg-muted/30 px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
