import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Account, CooperativeUnit, ExpenseAccountsResponse, ExpenseEntry } from "@siskop/types";
import { apiFetch, apiFetchPage, apiDelete, apiPost, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { useAccessibleUnits } from "@/hooks/useAccessibleUnits";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { formatRupiah } from "@/lib/format";

const LIMIT = 20;
const NO_UNIT = "__none__";

const schema = z.object({
  entryDate: z.string().min(1, "Tanggal wajib diisi"),
  description: z.string().min(1, "Keterangan wajib diisi"),
  amount: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  debitAccountId: z.string().min(1, "Pilih akun beban"),
  creditAccountId: z.string().min(1, "Pilih akun kas/bank"),
  unitId: z.string().optional()
});
type FormValues = z.infer<typeof schema>;

export function ExpensesPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiError, setApiError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntry | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["expenses", { page }],
    queryFn: () => apiFetchPage<ExpenseEntry[]>(`/expenses?page=${page}&limit=${LIMIT}`)
  });
  const { data: accounts } = useQuery({
    queryKey: ["expenses", "accounts"],
    queryFn: () => apiFetch<ExpenseAccountsResponse>("/expenses/accounts")
  });
  const { data: units } = useAccessibleUnits();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { entryDate: "", description: "", amount: 0, debitAccountId: "", creditAccountId: "", unitId: "" }
  });
  const values = watch();

  const openCreate = () => {
    setApiError("");
    reset({ entryDate: new Date().toISOString().slice(0, 10), description: "", amount: 0, debitAccountId: "", creditAccountId: "", unitId: "" });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    try {
      await apiPost("/expenses", { ...values, unitId: values.unitId || undefined });
      toast({ title: "Beban tercatat" });
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiDelete(`/expenses/${deleteTarget.id}`);
      toast({ title: "Beban dihapus" });
      setDeleteTarget(null);
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal menghapus beban",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<ExpenseEntry>[] = [
    { header: "Tanggal", cell: ({ row }) => new Date(row.original.entryDate).toLocaleDateString("id-ID") },
    { header: "Keterangan", accessorKey: "description" },
    { header: "Akun Beban", accessorKey: "debitAccountName" },
    { header: "Akun Kredit", accessorKey: "creditAccountName" },
    { header: "Unit", cell: ({ row }) => row.original.unitName ?? "Semua Unit" },
    { header: "Jumlah", cell: ({ row }) => formatRupiah(row.original.amount) },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("expenses", "delete") && (
          <Button size="sm" variant="outline" onClick={() => setDeleteTarget(row.original)}>
            Hapus
          </Button>
        )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Beban Umum" description="Catat pengeluaran administrasi koperasi — gaji, sewa, dan beban umum lainnya" />

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        pagination={{ page, limit: LIMIT, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyMessage="Belum ada beban tercatat"
        headerActions={
          can("expenses", "create") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Catat Beban
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Catat Beban</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Tanggal *</Label>
              <Input type="date" {...register("entryDate")} />
              {errors.entryDate && <p className="text-xs text-destructive">{errors.entryDate.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Keterangan *</Label>
              <Input placeholder="Contoh: Gaji staf September 2026" {...register("description")} />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Jumlah (Rp) *</Label>
              <Input type="number" step="1" {...register("amount")} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Akun Beban *</Label>
                <Select value={values.debitAccountId} onValueChange={(v) => setValue("debitAccountId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts?.debitAccounts ?? []).map((a: Account) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.debitAccountId && <p className="text-xs text-destructive">{errors.debitAccountId.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Dibayar dari *</Label>
                <Select value={values.creditAccountId} onValueChange={(v) => setValue("creditAccountId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts?.creditAccounts ?? []).map((a: Account) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.creditAccountId && <p className="text-xs text-destructive">{errors.creditAccountId.message}</p>}
              </div>
            </div>

            {(units ?? []).length > 1 && (
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select
                  value={values.unitId || NO_UNIT}
                  onValueChange={(v) => setValue("unitId", v === NO_UNIT ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_UNIT}>Semua Unit</SelectItem>
                    {(units ?? []).map((u: CooperativeUnit) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

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
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus beban ini?"
        description="Jurnal beban ini akan dihapus. Jika ini kesalahan input, catat ulang dengan data yang benar."
        variant="destructive"
        onConfirm={onDelete}
      />
    </div>
  );
}
