import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PermissionAction, PermissionModule, Permissions, Role } from "@siskop/types";
import { apiFetch, apiDelete, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

const MODULES: { key: PermissionModule; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "members", label: "Anggota" },
  { key: "savings", label: "Simpanan" },
  { key: "loans", label: "Pinjaman" },
  { key: "reports", label: "Laporan" },
  { key: "config", label: "Konfigurasi" },
  { key: "users", label: "Pengguna" },
  { key: "roles", label: "Role" },
  { key: "accounting", label: "Akuntansi" }
];
const ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: "create", label: "Buat" },
  { key: "read", label: "Lihat" },
  { key: "update", label: "Ubah" },
  { key: "delete", label: "Hapus" },
  { key: "export", label: "Ekspor" }
];

function emptyPermissions(): Permissions {
  const base = {} as Permissions;
  for (const { key } of MODULES) {
    base[key] = {};
  }
  return base;
}

export function RolesTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<Permissions>(emptyPermissions());
  const [apiError, setApiError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  const { data, isPending, refetch } = useQuery({
    queryKey: ["config", "roles"],
    queryFn: () => apiFetch<Role[]>("/config/roles")
  });

  const openCreate = () => {
    setEditing(null);
    setApiError("");
    setName("");
    setPermissions(emptyPermissions());
    setDialogOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setApiError("");
    setName(role.name);
    setPermissions(role.permissions);
    setDialogOpen(true);
  };

  const toggle = (module: PermissionModule, action: PermissionAction) => {
    setPermissions((prev) => ({
      ...prev,
      [module]: { ...prev[module], [action]: !prev[module]?.[action] }
    }));
  };

  const onSubmit = async () => {
    setApiError("");
    if (name.trim().length < 2) {
      setApiError("Nama role minimal 2 karakter");
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await apiPut(`/config/roles/${editing.id}`, { name, permissions });
        toast({ title: "Role diperbarui" });
      } else {
        await apiPost("/config/roles", { name, permissions });
        toast({ title: "Role ditambahkan" });
      }
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiDelete(`/config/roles/${deleteTarget.id}`);
      toast({ title: "Role dihapus" });
      setDeleteTarget(null);
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal menghapus role",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<Role>[] = [
    { header: "Nama Role", accessorKey: "name" },
    {
      header: "Aksi",
      cell: ({ row }) => (
        <div className="flex gap-2">
          {can("roles", "update") && (
            <Button size="sm" variant="outline" onClick={() => openEdit(row.original)}>
              Edit
            </Button>
          )}
          {can("roles", "delete") && (
            <Button size="sm" variant="outline" onClick={() => setDeleteTarget(row.original)}>
              Hapus
            </Button>
          )}
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
        emptyMessage="Belum ada role"
        headerActions={
          can("roles", "create") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Role
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Role" : "Tambah Role"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Nama Role *</Label>
              <Input placeholder="Kasir" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="max-h-96 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 text-left font-medium">Modul</th>
                    {ACTIONS.map((a) => (
                      <th key={a.key} className="p-2 text-center font-medium">
                        {a.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m.key} className="border-t">
                      <td className="p-2">{m.label}</td>
                      {ACTIONS.map((a) => (
                        <td key={a.key} className="p-2 text-center">
                          <Checkbox
                            checked={permissions[m.key]?.[a.key] ?? false}
                            onCheckedChange={() => toggle(m.key, a.key)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Batal
              </Button>
              <Button type="button" disabled={submitting} onClick={onSubmit}>
                {submitting ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus role?"
        description={`Role "${deleteTarget?.name}" akan dihapus permanen. Role yang masih digunakan pengguna tidak dapat dihapus.`}
        variant="destructive"
        onConfirm={onDelete}
      />
    </div>
  );
}
