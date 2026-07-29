import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { SubscriptionPackage } from "@siskop/types";
import { apiFetch, apiPost, apiPut, apiDelete, ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Plus } from "lucide-react";

const schema = z.object({
  name: z.string().min(2, "Nama paket minimal 2 karakter"),
  price: z.coerce.number().min(0, "Harga tidak boleh negatif"),
  accounting: z.boolean(),
  maxUsers: z.coerce.number().int().min(1, "Minimal 1 pengguna"),
  maxMembers: z.coerce.number().int().min(1, "Minimal 1 anggota"),
  maxSavingConfigs: z.string(),
  whitelabelEnabled: z.boolean()
});
type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  name: "",
  price: 0,
  accounting: false,
  maxUsers: 5,
  maxMembers: 100,
  maxSavingConfigs: "",
  whitelabelEnabled: false
};

export function PlatformPackagesPage() {
  const role = useAuth((s) => s.user?.role);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPackage | null>(null);
  const [deactivating, setDeactivating] = useState<SubscriptionPackage | null>(null);
  const [apiError, setApiError] = useState("");

  const { data, isPending, refetch } = useQuery({
    queryKey: ["platform", "packages"],
    queryFn: () => apiFetch<SubscriptionPackage[]>("/platform/packages")
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });
  const values = watch();

  if (role !== "super_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  const openCreate = () => {
    setEditing(null);
    setApiError("");
    reset(DEFAULTS);
    setDialogOpen(true);
  };

  const openEdit = (pkg: SubscriptionPackage) => {
    setEditing(pkg);
    setApiError("");
    reset({
      name: pkg.name,
      price: Number(pkg.price),
      accounting: pkg.modules.includes("accounting"),
      maxUsers: pkg.maxUsers,
      maxMembers: pkg.maxMembers,
      maxSavingConfigs: pkg.maxSavingConfigs === null ? "" : String(pkg.maxSavingConfigs),
      whitelabelEnabled: pkg.whitelabelEnabled
    });
    setDialogOpen(true);
  };

  const onSubmit = async (v: FormValues) => {
    setApiError("");
    const payload = {
      name: v.name,
      price: v.price,
      modules: v.accounting ? (["accounting"] as const) : [],
      maxUsers: v.maxUsers,
      maxMembers: v.maxMembers,
      maxSavingConfigs: v.maxSavingConfigs === "" ? null : Number(v.maxSavingConfigs),
      whitelabelEnabled: v.whitelabelEnabled
    };
    try {
      if (editing) {
        await apiPut(`/platform/packages/${editing.id}`, payload);
        toast({ title: "Paket diperbarui" });
      } else {
        await apiPost("/platform/packages", payload);
        toast({ title: "Paket ditambahkan" });
      }
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onDeactivate = async () => {
    if (!deactivating) return;
    try {
      await apiDelete(`/platform/packages/${deactivating.id}`);
      toast({ title: "Paket dinonaktifkan" });
      setDeactivating(null);
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal menonaktifkan paket",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<SubscriptionPackage>[] = [
    { header: "Nama Paket", accessorKey: "name" },
    { header: "Harga", cell: ({ row }) => `Rp${Number(row.original.price).toLocaleString("id-ID")}` },
    {
      header: "Modul",
      cell: ({ row }) =>
        row.original.modules.length > 0 ? (
          row.original.modules.map((m) => (
            <Badge key={m} variant="outline" className="mr-1">
              {m}
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground">Dasar</span>
        )
    },
    { header: "Maks. Pengguna", cell: ({ row }) => row.original.maxUsers },
    { header: "Maks. Anggota", cell: ({ row }) => row.original.maxMembers },
    { header: "Whitelabel", cell: ({ row }) => (row.original.whitelabelEnabled ? "Ya" : "Tidak") },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "secondary"}>
          {row.original.isActive ? "Aktif" : "Nonaktif"}
        </Badge>
      )
    },
    {
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => openEdit(row.original)}>
            Ubah
          </Button>
          {row.original.isActive && (
            <Button variant="outline" size="sm" onClick={() => setDeactivating(row.original)}>
              Nonaktifkan
            </Button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Paket Langganan" description="Kelola paket langganan yang tersedia untuk koperasi" />

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        emptyMessage="Belum ada paket langganan"
        headerActions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Tambah Paket
          </Button>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Ubah Paket" : "Tambah Paket"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Nama Paket *</Label>
              <Input placeholder="Paket Lengkap" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Harga (Rp) *</Label>
                <Input type="number" min="0" {...register("price")} />
                {errors.price && <p className="text-xs text-destructive">{errors.price.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Maks. Simpanan Custom</Label>
                <Input type="number" min="0" placeholder="Tanpa batas" {...register("maxSavingConfigs")} />
              </div>
              <div className="space-y-1.5">
                <Label>Maks. Pengguna *</Label>
                <Input type="number" min="1" {...register("maxUsers")} />
                {errors.maxUsers && <p className="text-xs text-destructive">{errors.maxUsers.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Maks. Anggota *</Label>
                <Input type="number" min="1" {...register("maxMembers")} />
                {errors.maxMembers && <p className="text-xs text-destructive">{errors.maxMembers.message}</p>}
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Entitlement</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="accounting"
                  checked={values.accounting}
                  onCheckedChange={(checked) => setValue("accounting", checked === true)}
                />
                <Label htmlFor="accounting" className="cursor-pointer font-normal">
                  Modul Akuntansi (Konfigurasi Akun, Laporan Regulasi)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="whitelabelEnabled"
                  checked={values.whitelabelEnabled}
                  onCheckedChange={(checked) => setValue("whitelabelEnabled", checked === true)}
                />
                <Label htmlFor="whitelabelEnabled" className="cursor-pointer font-normal">
                  Whitelabel (domain kustom, branding)
                </Label>
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

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title="Nonaktifkan paket?"
        description={`Paket "${deactivating?.name}" tidak akan bisa dipilih untuk koperasi baru. Koperasi yang sudah memakai paket ini tidak terpengaruh.`}
        confirmLabel="Nonaktifkan"
        variant="destructive"
        onConfirm={onDeactivate}
      />
    </div>
  );
}
