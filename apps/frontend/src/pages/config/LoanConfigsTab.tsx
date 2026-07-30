import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { LoanConfig } from "@siskop/types";
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
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN"]),
  rate: z.coerce.number().min(0).max(100),
  maxTermMonths: z.coerce.number().int().min(1).max(360)
});
type FormValues = z.infer<typeof schema>;

export function LoanConfigsTab() {
  const { can } = usePermissions();
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

  const openCreate = () => {
    setEditing(null);
    setApiError("");
    reset({ name: "", type: "KONVENSIONAL", rateType: "BUNGA", rate: 0, maxTermMonths: 12 });
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
      maxTermMonths: config.maxTermMonths
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
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const columns: ColumnDef<LoanConfig>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Jenis", cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge> },
    { header: "Tipe Imbal Hasil", accessorKey: "rateType" },
    { header: "Rate (%)", cell: ({ row }) => Number(row.original.rate).toString() },
    { header: "Maks. Tenor (bulan)", accessorKey: "maxTermMonths" },
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
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Pinjaman
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Konfigurasi Pinjaman" : "Tambah Konfigurasi Pinjaman"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Nama *</Label>
              <Input placeholder="KUR Mikro" {...register("name")} />
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
                    <SelectItem value="KONVENSIONAL">Konvensional</SelectItem>
                    <SelectItem value="SYARIAH">Syariah</SelectItem>
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
                <Label>Maks. Tenor (bulan) *</Label>
                <Input type="number" {...register("maxTermMonths")} />
                {errors.maxTermMonths && <p className="text-xs text-destructive">{errors.maxTermMonths.message}</p>}
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
