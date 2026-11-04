import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { ReferralPartnerSummary, ReferralPayoutRow, ReferralPayoutStatus } from "@siskop/types";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createPayoutBody, markPaidBody } from "./partners/helpers";
import { day, rupiah } from "./partners/shared";

const STATUS_LABEL: Record<ReferralPayoutStatus, string> = { DRAFT: "Draf", PAID: "Dibayar", CANCELLED: "Dibatalkan" };
const STATUS_VARIANT: Record<ReferralPayoutStatus, "default" | "secondary" | "outline"> = { DRAFT: "outline", PAID: "default", CANCELLED: "secondary" };
const message = (err: unknown) => (err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");

function CreatePayoutDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const partners = useQuery({ queryKey: ["platform", "partners"], queryFn: () => apiFetch<ReferralPartnerSummary[]>("/platform/partners") });
  const eligible = (partners.data ?? []).filter((p) => Number(p.commissionOutstanding) > 0);
  const [partnerId, setPartnerId] = useState("");
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const built = createPayoutBody(partnerId, periodEnd);
    if (!built.ok) return setError(built.problem);
    setBusy(true);
    setError("");
    try {
      const created = await apiPost<ReferralPayoutRow>("/platform/payouts", built.body);
      toast({ title: `Pembayaran ${created.number} dibuat` });
      onSaved();
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat pembayaran komisi</DialogTitle>
          <DialogDescription>Mengumpulkan semua komisi terhutang mitra sampai akhir tanggal yang dipilih (WIB).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="po-partner">Mitra *</Label>
            <select id="po-partner" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">{partners.isPending ? "Memuat…" : eligible.length === 0 ? "Tidak ada komisi terhutang" : "Pilih mitra"}</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · terhutang {rupiah(p.commissionOutstanding)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="po-end">Sampai tanggal *</Label>
            <Input id="po-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>
        {error && <FormError error={error} />}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Membuat..." : "Buat draf"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MarkPaidDialog({ payout, onClose, onSaved }: { payout: ReferralPayoutRow; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ transferRef: "", paidOn: "", taxWithheld: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tax = Number(form.taxWithheld) || 0;

  async function save() {
    const built = markPaidBody(form, payout.grossAmount);
    if (!built.ok) return setError(built.problem);
    setBusy(true);
    setError("");
    try {
      await apiPost(`/platform/payouts/${payout.id}/mark-paid`, built.body);
      toast({ title: `${payout.number} ditandai dibayar` });
      onSaved();
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tandai {payout.number} dibayar</DialogTitle>
          <DialogDescription>
            Catat setelah transfer bank ke {payout.partner.name} selesai. Jumlah kotor {rupiah(payout.grossAmount)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="mp-ref">Referensi transfer *</Label>
            <Input id="mp-ref" value={form.transferRef} onChange={(e) => setForm({ ...form, transferRef: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-date">Tanggal transfer (kosong = hari ini)</Label>
            <Input id="mp-date" type="date" value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-tax">Pajak dipotong (PPh)</Label>
            <Input id="mp-tax" inputMode="decimal" placeholder="0" value={form.taxWithheld} onChange={(e) => setForm({ ...form, taxWithheld: e.target.value })} />
          </div>
          <p className="col-span-2 text-sm">
            Ditransfer bersih: <strong>{rupiah(String(Math.max(0, Number(payout.grossAmount) - tax)))}</strong>
          </p>
        </div>
        {error && <FormError error={error} />}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Menyimpan..." : "Tandai dibayar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PlatformPayoutsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"ALL" | ReferralPayoutStatus>("ALL");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<ReferralPayoutRow | null>(null);
  const [cancelling, setCancelling] = useState<ReferralPayoutRow | null>(null);
  const list = useQuery({
    queryKey: ["platform", "payouts", filter],
    queryFn: () => apiFetch<ReferralPayoutRow[]>(`/platform/payouts${filter === "ALL" ? "" : `?status=${filter}`}`)
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["platform", "payouts"] });
    void queryClient.invalidateQueries({ queryKey: ["platform", "partners"] });
  };

  async function cancel() {
    if (!cancelling) return;
    try {
      await apiPost(`/platform/payouts/${cancelling.id}/cancel`, {});
      toast({ title: `${cancelling.number} dibatalkan, komisi kembali terhutang` });
      setCancelling(null);
      refresh();
    } catch (err) {
      toast({ title: "Gagal membatalkan", description: message(err), variant: "destructive" });
    }
  }

  const columns: ColumnDef<ReferralPayoutRow>[] = [
    { header: "Nomor", accessorKey: "number" },
    {
      header: "Mitra",
      cell: ({ row }) => (
        <Link className="underline-offset-2 hover:underline" to={`/platform/partners/${row.original.partner.id}`}>
          {row.original.partner.name}
        </Link>
      )
    },
    { header: "Sampai", cell: ({ row }) => day(row.original.periodEnd) },
    { header: "Komisi", accessorKey: "commissionCount" },
    { header: "Kotor", cell: ({ row }) => rupiah(row.original.grossAmount) },
    { header: "Pajak", cell: ({ row }) => rupiah(row.original.taxWithheld) },
    { header: "Bersih", cell: ({ row }) => rupiah(row.original.netAmount) },
    {
      header: "Status",
      cell: ({ row }) => (
        <span>
          <Badge variant={STATUS_VARIANT[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>
          {row.original.transferRef ? <span className="ml-2 text-xs text-muted-foreground">{row.original.transferRef}</span> : null}
        </span>
      )
    },
    {
      header: "",
      cell: ({ row }) =>
        row.original.status === "DRAFT" ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setPaying(row.original)}>
              Tandai dibayar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCancelling(row.original)}>
              Batalkan
            </Button>
          </div>
        ) : null
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Pembayaran komisi" description="Kumpulkan komisi terhutang per mitra, transfer lewat bank, lalu catat referensinya" />
      <div className="flex items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <TabsList>
            <TabsTrigger value="ALL">Semua</TabsTrigger>
            <TabsTrigger value="DRAFT">Draf</TabsTrigger>
            <TabsTrigger value="PAID">Dibayar</TabsTrigger>
            <TabsTrigger value="CANCELLED">Dibatalkan</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Buat pembayaran
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={list.data ?? []}
        isLoading={list.isPending}
        isError={list.isError}
        errorMessage={list.error instanceof Error ? list.error.message : undefined}
        onRetry={list.refetch}
        emptyMessage="Belum ada pembayaran komisi"
      />
      {creating && <CreatePayoutDialog onClose={() => setCreating(false)} onSaved={refresh} />}
      {paying && <MarkPaidDialog payout={paying} onClose={() => setPaying(null)} onSaved={refresh} />}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Batalkan draf pembayaran?"
        description={`${cancelling?.number} dibatalkan dan komisinya kembali terhutang, siap dimasukkan ke pembayaran berikutnya.`}
        confirmLabel="Batalkan draf"
        variant="destructive"
        onConfirm={cancel}
      />
    </div>
  );
}
