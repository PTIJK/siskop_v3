import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { CooperativeUnit } from "@siskop/types";
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

const UNIT_TYPES = ["KSP", "KONSUMEN", "PRODUSEN", "JASA", "PEMASARAN"] as const;

const schema = z.object({
  type: z.enum(UNIT_TYPES),
  name: z.string().min(1, "Nama unit wajib diisi")
});
type FormValues = z.infer<typeof schema>;

export function UnitsTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CooperativeUnit | null>(null);
  const [apiError, setApiError] = useState("");

  const { data, isPending, refetch } = useQuery({
    queryKey: ["config", "units"],
    queryFn: () => apiFetch<CooperativeUnit[]>("/config/units")
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
    reset({ type: "KSP", name: "" });
    setDialogOpen(true);
  };

  const openEdit = (unit: CooperativeUnit) => {
    setEditing(unit);
    setApiError("");
    reset({ type: unit.type, name: unit.name });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    try {
      if (editing) {
        await apiPut(`/config/units/${editing.id}`, values);
        toast({ title: "Unit koperasi diperbarui" });
      } else {
        await apiPost("/config/units", values);
        toast({ title: "Unit koperasi ditambahkan" });
      }
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const toggleActive = async (unit: CooperativeUnit) => {
    try {
      await apiPut(`/config/units/${unit.id}`, { isActive: !unit.isActive });
      toast({ title: unit.isActive ? "Unit dinonaktifkan" : "Unit diaktifkan kembali" });
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal mengubah status unit",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<CooperativeUnit>[] = [
    { header: "Nama Unit", accessorKey: "name" },
    { header: "Jenis", cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge> },
    {
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Aktif" : "Nonaktif"}</Badge>
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("config", "update") && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => openEdit(row.original)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => toggleActive(row.original)}>
              {row.original.isActive ? "Nonaktifkan" : "Aktifkan"}
            </Button>
          </div>
        )
    }
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        emptyMessage="Belum ada unit koperasi"
        headerActions={
          can("config", "update") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Unit
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Unit Koperasi" : "Tambah Unit Koperasi"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Nama Unit *</Label>
              <Input placeholder="Simpan Pinjam" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Jenis *</Label>
              <Select value={values.type} onValueChange={(v: FormValues["type"]) => setValue("type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
