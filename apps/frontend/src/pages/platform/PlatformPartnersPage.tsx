import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Settings } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReferralPartnerDetail, ReferralPartnerSummary } from "@siskop/types";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { approveBody, percent, rejectProblem, shareLink } from "./partners/helpers";
import { PartnerFormDialog, ReferralSettingsDialog } from "./partners/PartnerDialogs";
import { CopyButton, day, rupiah, STATUS_LABEL, STATUS_VARIANT } from "./partners/shared";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value || "—"}</dd>
    </div>
  );
}

function ReviewDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const detail = useQuery({ queryKey: ["platform", "partners", id], queryFn: () => apiFetch<ReferralPartnerDetail>(`/platform/partners/${id}`) });
  const [mode, setMode] = useState<"view" | "reject">("view");
  const [code, setCode] = useState("");
  const [ratePercent, setRatePercent] = useState("");
  const [months, setMonths] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const p = detail.data;

  async function run(action: () => Promise<unknown>, title: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      toast({ title });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setBusy(false);
    }
  }

  const approve = () => {
    const built = approveBody({ code, ratePercent, months });
    if (!built.ok) return setError(built.problem);
    void run(() => apiPost(`/platform/partners/${id}/approve`, built.body), "Mitra disetujui, email terkirim");
  };
  const reject = () => {
    const problem = rejectProblem(reason);
    if (problem) return setError(problem);
    void run(() => apiPost(`/platform/partners/${id}/reject`, { reason: reason.trim() }), "Pendaftaran ditolak");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{p?.name ?? "Pendaftaran mitra"}</DialogTitle>
          <DialogDescription>Data yang diisi pendaftar</DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : detail.isError || !p ? (
          <FormError error="Data mitra tidak dapat dimuat" />
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Email" value={p.email} />
              <Field label="WhatsApp" value={p.phone} />
              <Field label="Kota" value={p.city} />
              <Field label="Provinsi" value={p.province} />
              <Field label="NIK" value={p.ktpNo} />
              <Field label="NPWP" value={p.npwp} />
              <Field label="Bank" value={p.bankName} />
              <Field label="No. rekening" value={p.bankAccountNo} />
              <Field label="Atas nama" value={p.bankAccountName} />
              <Field label="Syarat disetujui" value={`${p.termsVersion ?? "—"} · ${day(p.termsAcceptedAt)}`} />
            </dl>
            <Field label="Rencana penjualan" value={p.salesPlan} />
            {p.status !== "PENDING" ? (
              <p className="text-sm">
                Status: <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                {p.code ? <> · Kode <strong>{p.code}</strong></> : null}
                {p.rejectReason ? <> · {p.rejectReason}</> : null}
              </p>
            ) : mode === "view" ? (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  Komisi standar {percent(p.commissionRate)} selama {p.commissionMonths} bulan. Isi kolom di bawah hanya untuk mengubahnya.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="appr-code">Kode (opsional)</Label>
                    <Input id="appr-code" placeholder="NEX-BUDI" value={code} onChange={(e) => setCode(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="appr-rate">Komisi %</Label>
                    <Input id="appr-rate" inputMode="decimal" placeholder={String(Number(p.commissionRate) * 100)} value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="appr-months">Bulan</Label>
                    <Input id="appr-months" inputMode="numeric" placeholder={String(p.commissionMonths)} value={months} onChange={(e) => setMonths(e.target.value)} />
                  </div>
                </div>
                {error && <FormError error={error} />}
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => { setError(""); setMode("reject"); }} disabled={busy}>
                    Tolak
                  </Button>
                  <Button onClick={approve} disabled={busy}>
                    {busy ? "Memproses..." : "Setujui & kirim kode"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 border-t pt-4">
                <Label htmlFor="rej-reason">Alasan penolakan (dikirim ke pendaftar)</Label>
                <Textarea id="rej-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                {error && <FormError error={error} />}
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => { setError(""); setMode("view"); }} disabled={busy}>
                    Kembali
                  </Button>
                  <Button variant="destructive" onClick={reject} disabled={busy}>
                    {busy ? "Memproses..." : "Tolak pendaftaran"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PlatformPartnersPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const list = useQuery({ queryKey: ["platform", "partners"], queryFn: () => apiFetch<ReferralPartnerSummary[]>("/platform/partners") });
  const rows = list.data ?? [];
  const pending = rows.filter((r) => r.status === "PENDING");
  const partners = rows.filter((r) => r.status !== "PENDING");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["platform", "partners"] });

  const applicationColumns: ColumnDef<ReferralPartnerSummary>[] = [
    { header: "Nama", accessorKey: "name" },
    { header: "Email", accessorKey: "email" },
    { header: "WhatsApp", accessorKey: "phone" },
    { header: "Diajukan", cell: ({ row }) => day(row.original.createdAt) },
    {
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setReviewing(row.original.id)}>
            Tinjau
          </Button>
        </div>
      )
    }
  ];

  const partnerColumns: ColumnDef<ReferralPartnerSummary>[] = [
    { header: "Nama", accessorKey: "name" },
    {
      header: "Kode",
      cell: ({ row }) =>
        row.original.code ? (
          <span className="flex items-center gap-2">
            {row.original.code}
            <CopyButton text={shareLink(window.location.origin, row.original.code)} label="Salin tautan" />
          </span>
        ) : (
          "—"
        )
    },
    { header: "Status", cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge> },
    { header: "Komisi", cell: ({ row }) => `${percent(row.original.commissionRate)} · ${row.original.commissionMonths} bln` },
    { header: "Koperasi", accessorKey: "referredTenants" },
    { header: "Omzet rujukan", cell: ({ row }) => rupiah(row.original.referredRevenue) },
    { header: "Belum dibayar", cell: ({ row }) => rupiah(row.original.commissionOutstanding) },
    {
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => (row.original.status === "REJECTED" ? setReviewing(row.original.id) : navigate(`/platform/partners/${row.original.id}`))}>
            Lihat
          </Button>
        </div>
      )
    }
  ];

  const common = {
    isLoading: list.isPending,
    isError: list.isError,
    errorMessage: list.error instanceof Error ? list.error.message : undefined,
    onRetry: list.refetch
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Mitra referral" description="Tinjau pendaftaran mitra dan pantau komisi dari koperasi yang dirujuk" />
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => setSettings(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Pengaturan program
        </Button>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Tambah mitra
        </Button>
      </div>
      <Tabs defaultValue="applications">
        <TabsList>
          <TabsTrigger value="applications">Pendaftaran{pending.length > 0 ? ` (${pending.length})` : ""}</TabsTrigger>
          <TabsTrigger value="partners">Mitra</TabsTrigger>
        </TabsList>
        <TabsContent value="applications">
          <DataTable columns={applicationColumns} data={pending} emptyMessage="Tidak ada pendaftaran yang menunggu" {...common} />
        </TabsContent>
        <TabsContent value="partners">
          <DataTable columns={partnerColumns} data={partners} emptyMessage="Belum ada mitra" {...common} />
        </TabsContent>
      </Tabs>
      {creating && <PartnerFormDialog partner={null} onClose={() => setCreating(false)} onSaved={refresh} />}
      {settings && <ReferralSettingsDialog onClose={() => setSettings(false)} />}
      {reviewing && <ReviewDialog key={reviewing} id={reviewing} onClose={() => setReviewing(null)} onDone={refresh} />}
    </div>
  );
}
