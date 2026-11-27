import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { SavingConfig } from "@siskop/types";
import { apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { calculateSavingInterest, SAVING_PERIOD_LABELS } from "@/lib/saving-calc";
import { usePermissions } from "@/hooks/usePermissions";
import { useEntitlements } from "@/hooks/useEntitlements";
import { QuotaBadge } from "@/components/shared/QuotaBadge";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

const MAX_ANNUAL_RATE = 9;

const schema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  type: z.enum(["POKOK", "WAJIB", "SUKARELA", "POKOK_WAJIB"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN"]),
  rate: z.coerce.number().min(0).max(MAX_ANNUAL_RATE, `Maksimal ${MAX_ANNUAL_RATE}% per tahun`),
  periodUnit: z.enum(["DAILY", "MONTHLY", "YEARLY"])
});
type FormValues = z.infer<typeof schema>;

const DEFAULT_SIMULATION_BALANCE = "1000000";
const PERIOD_TEXT = { DAILY: "hari", MONTHLY: "bulan", YEARLY: "tahun" } as const;
const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function SavingConfigsTab({ actionsTarget, onSetupSaved }: { actionsTarget: HTMLDivElement | null; onSetupSaved?: () => Promise<void> }) {
  const { can } = usePermissions();
  const { quota } = useEntitlements();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SavingConfig | null>(null);
  const [apiError, setApiError] = useState("");
  const [simulationBalance, setSimulationBalance] = useState(DEFAULT_SIMULATION_BALANCE);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["config", "saving-configs"],
    queryFn: () => apiFetch<SavingConfig[]>("/savings/configs")
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
    setSimulationBalance(DEFAULT_SIMULATION_BALANCE);
    reset({ name: "", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
    setDialogOpen(true);
  };

  const openEdit = (config: SavingConfig) => {
    setEditing(config);
    setSimulationBalance(DEFAULT_SIMULATION_BALANCE);
    setApiError("");
    reset({
      name: config.name,
      type: config.type,
      rateType: config.rateType as FormValues["rateType"],
      rate: Number(config.rate),
      periodUnit: config.periodUnit as FormValues["periodUnit"]
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    try {
      if (editing) {
        await apiPut(`/savings/configs/${editing.id}`, values);
        toast({ title: "Konfigurasi simpanan diperbarui" });
      } else {
        await apiPost("/savings/configs", values);
        toast({ title: "Konfigurasi simpanan ditambahkan" });
      }
      setDialogOpen(false);
      void refetch();
      if (onSetupSaved) await onSetupSaved();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const columns: ColumnDef<SavingConfig>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Jenis", cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge> },
    { header: "Tipe Imbal Hasil", accessorKey: "rateType" },
    { header: "Rate (%)", cell: ({ row }) => Number(row.original.rate).toString() },
    {
      header: "Periode",
      cell: ({ row }) => SAVING_PERIOD_LABELS[row.original.periodUnit as keyof typeof SAVING_PERIOD_LABELS] ?? row.original.periodUnit
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

  const addAction = can("config", "update") && (
    <div className="flex flex-wrap items-center gap-3">
      <QuotaBadge hint={quota("savingTypes")} noun="jenis" />
      <Button data-setup-target={onSetupSaved ? "add" : undefined} onClick={openCreate} className={onSetupSaved ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : undefined} disabled={quota("savingTypes")?.blocked}>
        <Plus aria-hidden="true" />
        Tambah Simpanan
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {actionsTarget && createPortal(addAction, actionsTarget)}
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        emptyMessage="Belum ada konfigurasi simpanan"
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-setup-dialog={onSetupSaved ? "" : undefined} className="max-w-[560px] gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-5 pr-14 text-left sm:px-6 sm:pr-14">
            <DialogTitle>{editing ? "Edit Konfigurasi Simpanan" : "Tambah Konfigurasi Simpanan"}</DialogTitle>
            <DialogDescription>Atur jenis simpanan, imbal hasil tahunan, dan periode perhitungannya.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4 px-5 py-5 sm:px-6">
              {apiError && <FormError error={apiError} />}

              <div className="space-y-1.5">
                <Label htmlFor="config-name">Nama simpanan</Label>
                <Input id="config-name" placeholder="Simpanan Sukarela" {...register("name")} />
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
                      <SelectItem value="POKOK">Pokok</SelectItem>
                      <SelectItem value="WAJIB">Wajib</SelectItem>
                      <SelectItem value="POKOK_WAJIB">Simpanan Pokok + Wajib</SelectItem>
                      <SelectItem value="SUKARELA">Sukarela</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="config-return-type">Tipe imbal hasil</Label>
                  <Select value={values.rateType} onValueChange={(v: FormValues["rateType"]) => setValue("rateType", v)}>
                    <SelectTrigger id="config-return-type" className="gap-2 text-left [&>span]:min-w-0 [&>svg]:shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUNGA">Bunga</SelectItem>
                      <SelectItem value="BAGI_HASIL">Bagi Hasil</SelectItem>
                      <SelectItem value="MARGIN">Margin</SelectItem>
                    </SelectContent>
                  </Select>
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
                  <Label htmlFor="config-period">Periode perhitungan</Label>
                  <Select value={values.periodUnit} onValueChange={(v: FormValues["periodUnit"]) => setValue("periodUnit", v)}>
                    <SelectTrigger id="config-period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">Harian</SelectItem>
                      <SelectItem value="MONTHLY">Bulanan</SelectItem>
                      <SelectItem value="YEARLY">Tahunan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {values.periodUnit && Number(values.rate) >= 0 && Number(values.rate) <= MAX_ANNUAL_RATE && (
                  <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-4 min-[440px]:col-span-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="saving-simulation-balance">Saldo untuk simulasi</Label>
                      <MoneyInput id="saving-simulation-balance" value={simulationBalance}
                        onValueChange={(digits) => setSimulationBalance(digits.slice(0, 15))} />
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1" aria-live="polite">
                      <p className="text-sm font-semibold">Perkiraan imbal hasil</p>
                      <p className="text-lg font-bold tabular-nums">
                        {rupiah.format(calculateSavingInterest(Number(simulationBalance), Number(values.rate), values.periodUnit))}
                        <span className="text-sm font-normal text-muted-foreground"> per {PERIOD_TEXT[values.periodUnit]}</span>
                      </p>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Saldo tetap {rupiah.format(Number(simulationBalance))} × {Number(values.rate).toLocaleString("id-ID")}% per tahun
                      {values.periodUnit === "MONTHLY" ? " ÷ 12 bulan" : values.periodUnit === "DAILY" ? " ÷ 360 hari" : ""}.
                    </p>
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
