import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { CooperativeType, PlatformTenantSummary, SubscriptionPackage } from "@siskop/types";
import { apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";

const UNIT_TYPES = ["KSP", "KONSUMEN", "PRODUSEN", "JASA", "PEMASARAN"] as const satisfies readonly CooperativeType[];

const schema = z.object({
  tenantName: z.string().min(1, "Nama koperasi wajib diisi"),
  slug: z
    .string()
    .min(1, "Slug wajib diisi")
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Hanya huruf kecil, angka, dan tanda hubung"),
  registrationNo: z.string().min(1, "Nomor badan hukum wajib diisi"),
  address: z.string().min(1, "Alamat wajib diisi"),
  type: z.enum(["KONVENSIONAL", "SYARIAH"]),
  cooperativeType: z.string().min(1, "Jenis usaha wajib diisi"),
  firstUnitType: z.enum(UNIT_TYPES),
  firstUnitName: z.string().min(1, "Nama unit wajib diisi"),
  adminName: z.string().min(1, "Nama admin wajib diisi"),
  adminEmail: z.string().email("Email tidak valid"),
  adminPassword: z.string().min(8, "Password minimal 8 karakter")
});
type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  tenantName: "",
  slug: "",
  registrationNo: "",
  address: "",
  type: "KONVENSIONAL",
  cooperativeType: "KSP",
  firstUnitType: "KSP",
  firstUnitName: "Simpan Pinjam",
  adminName: "",
  adminEmail: "",
  adminPassword: ""
};

export function PlatformTenantsPage() {
  const role = useAuth((s) => s.user?.role);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiError, setApiError] = useState("");
  const [managing, setManaging] = useState<PlatformTenantSummary | null>(null);
  const [managePackageId, setManagePackageId] = useState("");
  const [manageIsActive, setManageIsActive] = useState(true);
  const [manageNextBillingDate, setManageNextBillingDate] = useState("");
  const [manageError, setManageError] = useState("");
  const [manageSaving, setManageSaving] = useState(false);

  const { data, isPending, refetch } = useQuery({
    queryKey: ["platform", "tenants"],
    queryFn: () => apiFetch<PlatformTenantSummary[]>("/platform/tenants")
  });

  const { data: packages } = useQuery({
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

  // Gate the whole page on the coarse platform-admin claim, not a tenant-scoped
  // permission — a tenant's own "Super Admin" role has no bearing on access here.
  if (role !== "super_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  const openCreate = () => {
    setApiError("");
    reset(DEFAULTS);
    setDialogOpen(true);
  };

  const openManage = (tenant: PlatformTenantSummary) => {
    setManageError("");
    setManaging(tenant);
    setManagePackageId(tenant.packageId ?? "");
    setManageIsActive(tenant.isActive);
    setManageNextBillingDate(tenant.nextBillingDate ? tenant.nextBillingDate.slice(0, 10) : "");
  };

  const onManageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managing) return;
    setManageError("");
    setManageSaving(true);
    try {
      await apiPut(`/platform/tenants/${managing.id}`, {
        packageId: managePackageId || null,
        isActive: manageIsActive,
        nextBillingDate: manageNextBillingDate || null
      });
      toast({ title: "Koperasi diperbarui" });
      setManaging(null);
      void refetch();
    } catch (err) {
      setManageError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setManageSaving(false);
    }
  };

  const onSubmit = async (v: FormValues) => {
    setApiError("");
    try {
      await apiPost("/platform/tenants", {
        tenantName: v.tenantName,
        slug: v.slug,
        registrationNo: v.registrationNo,
        address: v.address,
        type: v.type,
        cooperativeType: v.cooperativeType,
        adminName: v.adminName,
        adminEmail: v.adminEmail,
        adminPassword: v.adminPassword,
        firstUnit: { type: v.firstUnitType, name: v.firstUnitName }
      });
      toast({ title: "Koperasi ditambahkan", description: `${v.tenantName} siap login di ${v.slug}.localhost` });
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const columns: ColumnDef<PlatformTenantSummary>[] = [
    { header: "Nama Koperasi", accessorKey: "name" },
    { header: "Subdomain", cell: ({ row }) => <span className="text-muted-foreground">{row.original.slug}.localhost</span> },
    { header: "Jenis", cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge> },
    { header: "Unit", cell: ({ row }) => row.original.unitCount },
    { header: "Pengguna", cell: ({ row }) => row.original.userCount },
    {
      header: "Paket",
      cell: ({ row }) => row.original.packageName ?? <span className="text-muted-foreground">Tanpa paket</span>
    },
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
        <Button variant="outline" size="sm" onClick={() => openManage(row.original)}>
          Kelola
        </Button>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Koperasi" description="Kelola seluruh koperasi (tenant) yang terdaftar di platform" />

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        emptyMessage="Belum ada koperasi terdaftar"
        headerActions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Tambah Koperasi
          </Button>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tambah Koperasi</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nama Koperasi *</Label>
                <Input placeholder="Koperasi Sejahtera Bersama" {...register("tenantName")} />
                {errors.tenantName && <p className="text-xs text-destructive">{errors.tenantName.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Slug (subdomain login) *</Label>
                <Input placeholder="sejahtera" {...register("slug")} />
                {errors.slug ? (
                  <p className="text-xs text-destructive">{errors.slug.message}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Login di {values.slug || "slug"}.localhost:3000</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Nomor Badan Hukum *</Label>
                <Input placeholder="KOP/001/2026" {...register("registrationNo")} />
                {errors.registrationNo && <p className="text-xs text-destructive">{errors.registrationNo.message}</p>}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>Alamat *</Label>
                <Textarea rows={2} placeholder="Jl. Merdeka No. 1, Jakarta" {...register("address")} />
                {errors.address && <p className="text-xs text-destructive">{errors.address.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Jenis Koperasi *</Label>
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
                <Label>Jenis Usaha *</Label>
                <Input placeholder="KSP" {...register("cooperativeType")} />
                {errors.cooperativeType && <p className="text-xs text-destructive">{errors.cooperativeType.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Jenis Unit Pertama *</Label>
                <Select
                  value={values.firstUnitType}
                  onValueChange={(v: FormValues["firstUnitType"]) => setValue("firstUnitType", v)}
                >
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

              <div className="space-y-1.5">
                <Label>Nama Unit Pertama *</Label>
                <Input placeholder="Simpan Pinjam" {...register("firstUnitName")} />
                {errors.firstUnitName && <p className="text-xs text-destructive">{errors.firstUnitName.message}</p>}
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">Admin Koperasi</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nama Admin *</Label>
                  <Input placeholder="Budi Santoso" {...register("adminName")} />
                  {errors.adminName && <p className="text-xs text-destructive">{errors.adminName.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label>Email Admin *</Label>
                  <Input type="email" placeholder="admin@koperasi.test" {...register("adminEmail")} />
                  {errors.adminEmail && <p className="text-xs text-destructive">{errors.adminEmail.message}</p>}
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Password Admin *</Label>
                  <Input type="password" {...register("adminPassword")} />
                  {errors.adminPassword && <p className="text-xs text-destructive">{errors.adminPassword.message}</p>}
                </div>
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

      <Dialog open={managing !== null} onOpenChange={(open) => !open && setManaging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kelola {managing?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onManageSubmit} className="space-y-4">
            {manageError && <FormError error={manageError} />}

            <div className="space-y-1.5">
              <Label>Paket Langganan</Label>
              <Select value={managePackageId || "none"} onValueChange={(v) => setManagePackageId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa paket</SelectItem>
                  {(packages ?? [])
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Tanggal Tagihan Berikutnya</Label>
              <Input
                type="date"
                value={manageNextBillingDate}
                onChange={(e) => setManageNextBillingDate(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="manageIsActive"
                checked={manageIsActive}
                onCheckedChange={(checked) => setManageIsActive(checked === true)}
              />
              <Label htmlFor="manageIsActive" className="cursor-pointer font-normal">
                Koperasi aktif (nonaktifkan untuk memblokir login)
              </Label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setManaging(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={manageSaving}>
                {manageSaving ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
