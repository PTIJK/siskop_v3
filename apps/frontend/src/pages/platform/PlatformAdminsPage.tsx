import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { PlatformAdmin } from "@siskop/types";
import { apiFetch, apiPost, apiPut, apiDelete, ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

const createSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  email: z.string().email("Email tidak valid"),
  password: z
    .string()
    .min(8, "Password minimal 8 karakter")
    .regex(/[A-Z]/, "Password harus mengandung huruf besar")
    .regex(/[0-9]/, "Password harus mengandung angka")
});
const editSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  email: z.string().email("Email tidak valid")
});
type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

export function PlatformAdminsPage() {
  const role = useAuth((s) => s.user?.role);
  const currentUserId = useAuth((s) => s.user?.id);
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformAdmin | null>(null);
  const [deactivating, setDeactivating] = useState<PlatformAdmin | null>(null);
  const [apiError, setApiError] = useState("");

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["platform", "admins"],
    queryFn: () => apiFetch<PlatformAdmin[]>("/platform/admins")
  });

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", email: "", password: "" }
  });
  const editForm = useForm<EditValues>({ resolver: zodResolver(editSchema), defaultValues: { name: "", email: "" } });

  if (role !== "super_admin") {
    return <Navigate to="/dashboard" replace />;
  }

  const openCreate = () => {
    setApiError("");
    createForm.reset({ name: "", email: "", password: "" });
    setCreateOpen(true);
  };

  const openEdit = (admin: PlatformAdmin) => {
    setApiError("");
    editForm.reset({ name: admin.name, email: admin.email });
    setEditing(admin);
  };

  const onCreate = async (v: CreateValues) => {
    setApiError("");
    try {
      await apiPost("/platform/admins", v);
      toast({ title: "Platform admin ditambahkan" });
      setCreateOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onEdit = async (v: EditValues) => {
    if (!editing) return;
    setApiError("");
    try {
      await apiPut(`/platform/admins/${editing.id}`, v);
      toast({ title: "Platform admin diperbarui" });
      setEditing(null);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onDeactivate = async () => {
    if (!deactivating) return;
    try {
      await apiDelete(`/platform/admins/${deactivating.id}`);
      toast({ title: "Platform admin dinonaktifkan" });
      setDeactivating(null);
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal menonaktifkan",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<PlatformAdmin>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Email", accessorKey: "email" },
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
          {row.original.isActive && row.original.id !== currentUserId && (
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
      <PageHeader title="Admin Platform" description="Kelola pengguna dengan akses administrasi seluruh platform" />

      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        emptyMessage="Belum ada admin platform"
        headerActions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Tambah Admin
          </Button>
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Admin Platform</DialogTitle>
          </DialogHeader>
          <form onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Nama *</Label>
              <Input placeholder="Nama admin" {...createForm.register("name")} />
              {createForm.formState.errors.name && (
                <p className="text-xs text-destructive">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="admin@siskop.com" {...createForm.register("email")} />
              {createForm.formState.errors.email && (
                <p className="text-xs text-destructive">{createForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Password *</Label>
              <Input type="password" {...createForm.register("password")} />
              {createForm.formState.errors.password && (
                <p className="text-xs text-destructive">{createForm.formState.errors.password.message}</p>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Admin Platform</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Nama *</Label>
              <Input placeholder="Nama admin" {...editForm.register("name")} />
              {editForm.formState.errors.name && (
                <p className="text-xs text-destructive">{editForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="admin@siskop.com" {...editForm.register("email")} />
              {editForm.formState.errors.email && (
                <p className="text-xs text-destructive">{editForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={editForm.formState.isSubmitting}>
                {editForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title="Nonaktifkan admin platform?"
        description={`Admin "${deactivating?.name}" tidak akan bisa login lagi.`}
        confirmLabel="Nonaktifkan"
        variant="destructive"
        onConfirm={onDeactivate}
      />
    </div>
  );
}
