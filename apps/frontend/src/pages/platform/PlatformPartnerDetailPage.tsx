import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { ReferralCommissionRow, ReferralPartnerDetail, TenantReferralRow } from "@siskop/types";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PartnerFormDialog, ReferralTermsDialog } from "./partners/PartnerDialogs";
import { CopyButton, day, rupiah, STATUS_LABEL, STATUS_VARIANT } from "./partners/shared";
import { percent, shareLink } from "./partners/helpers";

const COMMISSION_VARIANT = { ACCRUED: "outline", PAID: "default", VOID: "secondary" } as const;
const COMMISSION_LABEL = { ACCRUED: "Terhutang", PAID: "Dibayar", VOID: "Dibatalkan" } as const;

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function VoidDialog({ commission, onClose, onDone }: { commission: ReferralCommissionRow; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (reason.trim().length < 3) return setError("Alasan wajib diisi (minimal 3 karakter).");
    setBusy(true);
    setError("");
    try {
      await apiPost(`/platform/commissions/${commission.id}/void`, { reason: reason.trim() });
      toast({ title: "Komisi dibatalkan" });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Batalkan komisi {rupiah(commission.amount)}?</DialogTitle>
          <DialogDescription>
            Faktur {commission.invoice.number} · {commission.tenant.name}. Komisi yang salah dibatalkan, bukan diubah nilainya.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Alasan *</Label>
          <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <FormError error={error} />}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Kembali
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Memproses..." : "Batalkan komisi"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PlatformPartnerDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [terms, setTerms] = useState<TenantReferralRow | null>(null);
  const [voiding, setVoiding] = useState<ReferralCommissionRow | null>(null);
  const detail = useQuery({ queryKey: ["platform", "partners", id], queryFn: () => apiFetch<ReferralPartnerDetail>(`/platform/partners/${id}`) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["platform", "partners"] });
  const p = detail.data;

  if (detail.isPending) return <Skeleton className="h-96 w-full" />;
  if (detail.isError || !p) return <FormError error={detail.error instanceof Error ? detail.error.message : "Mitra tidak ditemukan"} />;

  const link = p.code ? shareLink(window.location.origin, p.code) : null;

  const referralColumns: ColumnDef<TenantReferralRow>[] = [
    {
      header: "Koperasi",
      cell: ({ row }) => (
        <span>
          {row.original.tenant.name}{" "}
          {row.original.flaggedSelfReferral && <Badge variant="destructive">Perlu dicek: email sama dengan pengelola</Badge>}
        </span>
      )
    },
    { header: "Komisi", cell: ({ row }) => `${percent(row.original.rate)} · ${row.original.months} bln` },
    { header: "Sejak", cell: ({ row }) => day(row.original.attributedAt) },
    { header: "Berakhir", cell: ({ row }) => day(row.original.windowEndsAt) },
    { header: "Sumber", cell: ({ row }) => (row.original.source === "ADMIN" ? "Admin" : "Pendaftaran") },
    {
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setTerms(row.original)}>
            Ubah komisi
          </Button>
        </div>
      )
    }
  ];

  const commissionColumns: ColumnDef<ReferralCommissionRow>[] = [
    { header: "Tanggal", cell: ({ row }) => day(row.original.accruedAt) },
    { header: "Koperasi", cell: ({ row }) => row.original.tenant.name },
    { header: "Faktur", cell: ({ row }) => row.original.invoice.number },
    { header: "Dasar", cell: ({ row }) => rupiah(row.original.baseAmount) },
    { header: "Tarif", cell: ({ row }) => percent(row.original.rate) },
    { header: "Komisi", cell: ({ row }) => rupiah(row.original.amount) },
    {
      header: "Status",
      cell: ({ row }) => (
        <span>
          <Badge variant={COMMISSION_VARIANT[row.original.status]}>{COMMISSION_LABEL[row.original.status]}</Badge>
          {row.original.voidReason ? <span className="ml-2 text-xs text-muted-foreground">{row.original.voidReason}</span> : null}
        </span>
      )
    },
    {
      header: "",
      cell: ({ row }) =>
        row.original.status === "ACCRUED" ? (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setVoiding(row.original)}>
              Batalkan
            </Button>
          </div>
        ) : null
    }
  ];

  return (
    <div className="space-y-6">
      <Link to="/platform/partners" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Mitra referral
      </Link>
      <PageHeader title={p.name} description={`${p.email} · ${p.phone}`} />
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
        {p.code && (
          <span className="flex items-center gap-2 text-sm">
            Kode <strong>{p.code}</strong> <CopyButton text={p.code} label="Salin kode" />
          </span>
        )}
        {link && <CopyButton text={link} label="Salin tautan" />}
        <span className="text-sm text-muted-foreground">
          Komisi {percent(p.commissionRate)} · {p.commissionMonths} bulan
        </span>
        {(p.status === "ACTIVE" || p.status === "SUSPENDED") && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Ubah
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Koperasi dirujuk" value={String(p.referredTenants)} />
        <Kpi label="Omzet rujukan" value={rupiah(p.referredRevenue)} />
        <Kpi label="Komisi tercatat" value={rupiah(p.commissionAccrued)} />
        <Kpi label="Belum dibayar" value={rupiah(p.commissionOutstanding)} />
      </div>

      <Tabs defaultValue="referrals">
        <TabsList>
          <TabsTrigger value="referrals">Koperasi ({p.referrals.length})</TabsTrigger>
          <TabsTrigger value="commissions">Komisi ({p.commissions.length})</TabsTrigger>
          <TabsTrigger value="payouts">Pembayaran ({p.payouts.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="referrals">
          <DataTable columns={referralColumns} data={p.referrals} emptyMessage="Belum ada koperasi yang dirujuk" />
        </TabsContent>
        <TabsContent value="commissions">
          <DataTable columns={commissionColumns} data={p.commissions} emptyMessage="Belum ada komisi" />
        </TabsContent>
        <TabsContent value="payouts">
          <DataTable
            columns={[
              { header: "Nomor", accessorKey: "number" },
              { header: "Periode s/d", cell: ({ row }) => day(row.original.periodEnd) },
              { header: "Kotor", cell: ({ row }) => rupiah(row.original.grossAmount) },
              { header: "Pajak", cell: ({ row }) => rupiah(row.original.taxWithheld) },
              { header: "Bersih", cell: ({ row }) => rupiah(row.original.netAmount) },
              { header: "Status", accessorKey: "status" }
            ]}
            data={p.payouts}
            emptyMessage="Belum ada pembayaran"
          />
        </TabsContent>
      </Tabs>

      {editing && <PartnerFormDialog partner={p} onClose={() => setEditing(false)} onSaved={refresh} />}
      {terms && <ReferralTermsDialog referral={terms} onClose={() => setTerms(null)} onSaved={refresh} />}
      {voiding && <VoidDialog commission={voiding} onClose={() => setVoiding(null)} onDone={refresh} />}
    </div>
  );
}
