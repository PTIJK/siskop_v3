import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Role, User } from "@siskop/types";
import { apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/stores/auth";
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

const createSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
  roleId: z.string().min(1, "Role wajib dipilih")
});

const editSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Email tidak valid"),
  roleId: z.string().min(1, "Role wajib dipilih")
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

export function UsersTab() {
  const { can } = usePermissions();
  const currentUser = useAuth((s) => s.user);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [apiError, setApiError] = useState("");

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<User[]>("/users")
  });

  const { data: roles } = useQuery({
    queryKey: ["config", "roles"],
    queryFn: () => apiFetch<Role[]>("/config/roles")
  });

  const createForm = useForm<CreateValues>({ resolver: zodResolver(createSchema) });
  const editForm = useForm<EditValues>({ resolver: zodResolver(editSchema) });

  const openCreate = () => {
    setEditing(null);
    setApiError("");
    createForm.reset({ name: "", email: "", password: "", roleId: "" });
    setDialogOpen(true);
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setApiError("");
    editForm.reset({ name: user.name, email: user.email, roleId: user.roleId });
    setDialogOpen(true);
  };

  const onCreate = async (values: CreateValues) => {
    setApiError("");
    try {
      await apiPost("/users", values);
      toast({ title: "Pengguna ditambahkan" });
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onEdit = async (values: EditValues) => {
    if (!editing) return;
    setApiError("");
    try {
      await apiPut(`/users/${editing.id}`, values);
      toast({ title: "Pengguna diperbarui" });
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const toggleActive = async (user: User) => {
    try {
      await apiPut(`/users/${user.id}`, { isActive: !user.isActive });
      toast({ title: user.isActive ? "Pengguna dinonaktifkan" : "Pengguna diaktifkan kembali" });
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal mengubah status pengguna",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<User>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Email", accessorKey: "email" },
    { header: "Role", cell: ({ row }) => <Badge variant="outline">{row.original.roleName}</Badge> },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "secondary"}>
          {row.original.isActive ? "Aktif" : "Nonaktif"}
        </Badge>
      )
    },
    {
      header: "Aksi",
      cell: ({ row }) => {
        const isSelf = row.original.id === currentUser?.id;
        return (
          can("users", "update") && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => openEdit(row.original)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isSelf}
                title={isSelf ? "Tidak dapat menonaktifkan akun sendiri" : undefined}
                onClick={() => toggleActive(row.original)}
              >
                {row.original.isActive ? "Nonaktifkan" : "Aktifkan"}
              </Button>
            </div>
          )
        );
      }
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
        emptyMessage="Belum ada pengguna"
        headerActions={
          can("users", "create") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Pengguna
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Pengguna" : "Tambah Pengguna"}</DialogTitle>
          </DialogHeader>

          {editing ? (
            <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-4">
              {apiError && <FormError error={apiError} />}

              <div className="space-y-1.5">
                <Label>Nama *</Label>
                <Input {...editForm.register("name")} />
                {editForm.formState.errors.name && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" {...editForm.register("email")} />
                {editForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{editForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select
                  value={editForm.watch("roleId")}
                  onValueChange={(v) => editForm.setValue("roleId", v, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={editForm.formState.isSubmitting}>
                  {editForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4">
              {apiError && <FormError error={apiError} />}

              <div className="space-y-1.5">
                <Label>Nama *</Label>
                <Input placeholder="Budi Santoso" {...createForm.register("name")} />
                {createForm.formState.errors.name && (
                  <p className="text-xs text-destructive">{createForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input type="email" placeholder="budi@koperasi.test" {...createForm.register("email")} />
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

              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select
                  value={createForm.watch("roleId")}
                  onValueChange={(v) => createForm.setValue("roleId", v, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {createForm.formState.errors.roleId && (
                  <p className="text-xs text-destructive">{createForm.formState.errors.roleId.message}</p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Batal
                </Button>
                <Button type="submit" disabled={createForm.formState.isSubmitting}>
                  {createForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
