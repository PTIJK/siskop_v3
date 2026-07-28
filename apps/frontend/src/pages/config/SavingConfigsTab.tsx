import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { SavingConfig } from "@siskop/types";
import { apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

const schema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  type: z.enum(["POKOK", "WAJIB", "SUKARELA"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN"]),
  rate: z.coerce.number().min(0).max(100),
  periodUnit: z.enum(["MONTHLY", "YEARLY"])
});
type FormValues = z.infer<typeof schema>;

export function SavingConfigsTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SavingConfig | null>(null);
  const [apiError, setApiError] = useState("");

  const { data, isPending, refetch } = useQuery({
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

  const openCreate = () => {
    setEditing(null);
    setApiError("");
    reset({ name: "", type: "POKOK", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
    setDialogOpen(true);
  };

  const openEdit = (config: SavingConfig) => {
    setEditing(config);
    setApiError("");
    reset({
      name: config.name,
      type: config.type,
      rateType: config.rateType,
      rate: Number(config.rate),
      periodUnit: config.periodUnit as "MONTHLY" | "YEARLY"
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
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const columns: ColumnDef<SavingConfig>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Jenis", cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge> },
    { header: "Tipe Imbal Hasil", accessorKey: "rateType" },
    { header: "Rate (%)", cell: ({ row }) => Number(row.original.rate).toString() },
    { header: "Periode", accessorKey: "periodUnit" },
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
        emptyMessage="Belum ada konfigurasi simpanan"
        headerActions={
          can("config", "update") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Simpanan
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Konfigurasi Simpanan" : "Tambah Konfigurasi Simpanan"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Nama *</Label>
              <Input placeholder="Simpanan Sukarela" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Jenis *</Label>
                <Select value={values.type} onValueChange={(v: FormValues["type"]) => setValue("type", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POKOK">Pokok</SelectItem>
                    <SelectItem value="WAJIB">Wajib</SelectItem>
                    <SelectItem value="SUKARELA">Sukarela</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Tipe Imbal Hasil *</Label>
                <Select value={values.rateType} onValueChange={(v: FormValues["rateType"]) => setValue("rateType", v)}>
                  <SelectTrigger>
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
                <Label>Rate (%) *</Label>
                <Input type="number" step="0.01" {...register("rate")} />
                {errors.rate && <p className="text-xs text-destructive">{errors.rate.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Periode *</Label>
                <Select value={values.periodUnit} onValueChange={(v: FormValues["periodUnit"]) => setValue("periodUnit", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Bulanan</SelectItem>
                    <SelectItem value="YEARLY">Tahunan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
