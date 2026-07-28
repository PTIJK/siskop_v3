import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Account, AccountMapping, LoanConfig, SavingConfig } from "@siskop/types";
import { apiFetch, apiDelete, apiPost, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";

const SOURCE_TYPES = ["SAVING_CONFIG", "LOAN_CONFIG", "SYSTEM"] as const;
const TRANSACTION_KINDS = [
  "DEPOSIT",
  "WITHDRAWAL",
  "DISBURSEMENT",
  "PAYMENT_PRINCIPAL",
  "PAYMENT_INTEREST",
  "PAYMENT_PENALTY"
] as const;

const schema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  sourceId: z.string().optional(),
  transactionKind: z.enum(TRANSACTION_KINDS),
  debitAccountId: z.string().min(1, "Pilih akun debit"),
  creditAccountId: z.string().min(1, "Pilih akun kredit")
});
type FormValues = z.infer<typeof schema>;

export function AccountMappingsTab() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiError, setApiError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AccountMapping | null>(null);

  const { data, isPending, refetch } = useQuery({
    queryKey: ["config", "account-mappings"],
    queryFn: () => apiFetch<AccountMapping[]>("/config/account-mappings")
  });
  const { data: accounts } = useQuery({
    queryKey: ["config", "accounts"],
    queryFn: () => apiFetch<Account[]>("/config/accounts")
  });
  const { data: savingConfigs } = useQuery({
    queryKey: ["config", "saving-configs"],
    queryFn: () => apiFetch<SavingConfig[]>("/savings/configs")
  });
  const { data: loanConfigs } = useQuery({
    queryKey: ["config", "loan-configs"],
    queryFn: () => apiFetch<LoanConfig[]>("/loans/configs")
  });

  const {
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { sourceType: "SAVING_CONFIG", sourceId: "", transactionKind: "DEPOSIT", debitAccountId: "", creditAccountId: "" }
  });
  const values = watch();

  const sourceOptions = values.sourceType === "SAVING_CONFIG" ? savingConfigs ?? [] : values.sourceType === "LOAN_CONFIG" ? loanConfigs ?? [] : [];

  const openCreate = () => {
    setApiError("");
    reset({ sourceType: "SAVING_CONFIG", sourceId: "", transactionKind: "DEPOSIT", debitAccountId: "", creditAccountId: "" });
    setDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    setApiError("");
    try {
      await apiPost("/config/account-mappings", { ...values, sourceId: values.sourceId || undefined });
      toast({ title: "Pemetaan akun disimpan" });
      setDialogOpen(false);
      void refetch();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiDelete(`/config/account-mappings/${deleteTarget.id}`);
      toast({ title: "Pemetaan akun dihapus" });
      setDeleteTarget(null);
      void refetch();
    } catch (err) {
      toast({
        title: "Gagal menghapus pemetaan",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  const columns: ColumnDef<AccountMapping>[] = [
    { header: "Sumber", cell: ({ row }) => <Badge variant="outline">{row.original.sourceType}</Badge> },
    { header: "Konfigurasi", cell: ({ row }) => row.original.sourceName ?? "—" },
    { header: "Jenis Transaksi", accessorKey: "transactionKind" },
    { header: "Akun Debit", accessorKey: "debitAccountName" },
    { header: "Akun Kredit", accessorKey: "creditAccountName" },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("accounting", "delete") && (
          <Button size="sm" variant="outline" onClick={() => setDeleteTarget(row.original)}>
            Hapus
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
        emptyMessage="Belum ada pemetaan akun — transaksi akan tercatat sebagai belum terposting sampai dipetakan"
        headerActions={
          can("accounting", "create") && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah Pemetaan
            </Button>
          )
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Pemetaan Akun</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && <FormError error={apiError} />}

            <div className="space-y-1.5">
              <Label>Sumber *</Label>
              <Select
                value={values.sourceType}
                onValueChange={(v: FormValues["sourceType"]) => {
                  setValue("sourceType", v);
                  setValue("sourceId", "");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SAVING_CONFIG">Konfigurasi Simpanan</SelectItem>
                  <SelectItem value="LOAN_CONFIG">Konfigurasi Pinjaman</SelectItem>
                  <SelectItem value="SYSTEM">Sistem (umum)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {values.sourceType !== "SYSTEM" && (
              <div className="space-y-1.5">
                <Label>Konfigurasi *</Label>
                <Select value={values.sourceId} onValueChange={(v) => setValue("sourceId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih konfigurasi" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Jenis Transaksi *</Label>
              <Select value={values.transactionKind} onValueChange={(v: FormValues["transactionKind"]) => setValue("transactionKind", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSACTION_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Akun Debit *</Label>
                <Select value={values.debitAccountId} onValueChange={(v) => setValue("debitAccountId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.debitAccountId && <p className="text-xs text-destructive">{errors.debitAccountId.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Akun Kredit *</Label>
                <Select value={values.creditAccountId} onValueChange={(v) => setValue("creditAccountId", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih akun" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.creditAccountId && <p className="text-xs text-destructive">{errors.creditAccountId.message}</p>}
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
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus pemetaan akun?"
        description="Transaksi baru untuk konfigurasi dan jenis transaksi ini tidak akan terposting ke jurnal sampai dipetakan ulang."
        variant="destructive"
        onConfirm={onDelete}
      />
    </div>
  );
}
