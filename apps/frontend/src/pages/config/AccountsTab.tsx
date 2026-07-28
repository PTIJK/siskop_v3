import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Account } from "@siskop/types";
import { apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

const CATEGORIES = ["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN"] as const;
const NO_PARENT = "__none__";

const schema = z.object({
  code: z.string().min(1, "Kode wajib diisi"),
  name: z.string().min(2, "Nama minimal 2 karakter"),
  category: z.enum(CATEGORIES),
  normalBalance: z.enum(["DEBIT", "KREDIT"]),
  parentId: z.string(),
  isHeader: z.boolean(),
  isCashEquivalent: z.boolean()
});
type FormValues = z.infer<typeof schema>;

/** Depth in the parent chain, for visual indentation — accounts arrive flat, ordered by code. */
function depthOf(account: Account, byId: Map<string, Account>): number {
  let depth = 0;
  let current = account;
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export function AccountsTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [apiError, setApiError] = useState("");

  const { data, isPending, refetch } = useQuery({
    queryKey: ["config", "accounts"],
    queryFn: () => apiFetch<Account[]>("/config/accounts")
  });

  const byId = useMemo(() => new Map((data ?? []).map((a) => [a.id, a])), [data]);

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
    reset({ code: "", name: "", category: "ASET", normalBalance: "DEBIT", parentId: NO_PARENT, isHeader: false, isCashEquivalent: false });
    setDialogOpen(true);
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    setApiError("");
    reset({
      code: account.code,
      name: account.name,
      category: account.category,
      normalBalance: account.normalBalance,
      parentId: account.parentId ?? NO_PARENT,
      isHeader: account.isHeader,
      isCashEquivalent: account.isCashEquivalent
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    const payload = { ...values, parentId: values.parentId === NO_PARENT ? undefined : values.parentId };
    try {
      if (editing) {
        await apiPut(`/config/accounts/${editing.id}`, payload);
        toast({ title: "Akun diperbarui" });
      } else {
        await apiPost("/config/accounts", payload);
        toast({ title: "Akun ditambahkan" });
      }
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const toggleActive = async (account: Account) => {
    try {
      await apiPut(`/config/accounts/${account.id}`, { isActive: !account.isActive });
      toast({ title: account.isActive ? "Akun dinonaktifkan" : "Akun diaktifkan kembali" });
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal mengubah status akun",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<Account>[] = [
    { header: "Kode", accessorKey: "code", className: "font-mono text-xs" },
    {
      header: "Nama Akun",
      cell: ({ row }) => (
        <span style={{ paddingLeft: `${depthOf(row.original, byId) * 1.25}rem` }}>
          {row.original.isHeader ? <span className="font-semibold">{row.original.name}</span> : row.original.name}
        </span>
      )
    },
    { header: "Kategori", cell: ({ row }) => <Badge variant="outline">{row.original.category}</Badge> },
    { header: "Saldo Normal", accessorKey: "normalBalance" },
    {
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Aktif" : "Nonaktif"}</Badge>
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("accounting", "update") && (
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

  const headerOptions = (data ?? []).filter((a) => !editing || a.id !== editing.id);

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={data ?? []}
        isLoading={isPending}
        emptyMessage="Belum ada akun — mulai dengan menambahkan Chart of Accounts"
        headerActions={
          can("accounting", "create") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Akun
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Akun" : "Tambah Akun"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Kode *</Label>
                <Input placeholder="1100" {...register("code")} />
                {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Nama *</Label>
                <Input placeholder="Kas" {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Kategori *</Label>
                <Select value={values.category} onValueChange={(v: FormValues["category"]) => setValue("category", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Saldo Normal *</Label>
                <Select value={values.normalBalance} onValueChange={(v: FormValues["normalBalance"]) => setValue("normalBalance", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEBIT">Debit</SelectItem>
                    <SelectItem value="KREDIT">Kredit</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label>Akun Induk</Label>
                <Select value={values.parentId} onValueChange={(v) => setValue("parentId", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>(Tidak ada — akun utama)</SelectItem>
                    {headerOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="col-span-2 flex items-center gap-2 text-sm">
                <Checkbox checked={values.isHeader} onCheckedChange={(v) => setValue("isHeader", !!v)} />
                Akun header (kelompok, tidak menerima transaksi langsung)
              </label>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <Checkbox checked={values.isCashEquivalent} onCheckedChange={(v) => setValue("isCashEquivalent", !!v)} />
                Setara kas (kas/bank)
              </label>
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
