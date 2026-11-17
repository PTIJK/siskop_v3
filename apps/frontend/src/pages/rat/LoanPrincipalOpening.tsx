import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RatLoanPrincipalOpening } from "@siskop/types";
import { apiFetch, apiPost } from "@/api/client";
import { FormError } from "@/components/shared/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { formatRupiahRinci, formatTanggalPendek } from "@/lib/format";

const path = "/reports/arsip-rat/loan-principal-opening";
const key = ["loans", "rat-principal-opening"] as const;

export function LoanPrincipalOpening() {
  const { can } = usePermissions();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const opening = useQuery({ queryKey: key, queryFn: () => apiFetch<RatLoanPrincipalOpening>(path), gcTime: 0 });
  const data = opening.data;

  async function post() {
    if (busy || !data || data.journal) return;
    setBusy(true);
    setError("");
    try {
      const saved = await apiPost<RatLoanPrincipalOpening>(path, {
        excelAmount: data.excelAmount, neracaAmount: data.neracaAmount, confirmed: true
      });
      client.setQueryData(key, saved);
      void client.invalidateQueries({ queryKey: ["reports"] });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saldo awal gagal dibukukan.");
    } finally {
      setBusy(false);
    }
  }

  if (opening.isError) return <div className="mb-4 flex flex-wrap items-center gap-3" role="alert">
    <FormError error={opening.error.message} />
    <Button size="sm" variant="outline" onClick={() => void opening.refetch()}>Coba lagi</Button>
  </div>;
  if (!data) return null;
  const amounts = [
    ["Sisa pokok Excel", data.excelAmount],
    ["Piutang menurut Neraca", data.neracaAmount],
    ["Selisih terhadap Neraca", data.difference]
  ] as const;
  const canPost = can("reports", "update") && can("accounting", "create");

  return <section className="mb-4 space-y-3 rounded-lg border bg-card p-4" aria-labelledby="rat-loan-principal-title">
    <div className="flex flex-wrap items-center gap-2">
      <h2 id="rat-loan-principal-title" className="font-semibold">Saldo awal pokok pinjaman RAT 2025</h2>
      <Badge variant="warn">Belum terverifikasi</Badge>
    </div>
    <p className="text-sm text-muted-foreground">{data.sourceRows} baris Excel · {formatTanggalPendek(data.cutoffDate)}
      {data.journal && " · Jurnal " + data.journal.entryNo + (data.journal.reversedOn ? " (dibalik)" : " (dibukukan)")}</p>
    <dl className="grid gap-3 sm:grid-cols-3">
      {amounts.map(([label, value]) => <div key={label}>
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="font-semibold tabular-nums">{formatRupiahRinci(value)}</dd>
      </div>)}
    </dl>
    <p className="text-sm text-muted-foreground">Koreksi baris Excel dapat disimpan untuk peninjauan. Saldo awal ini tidak membuat kontrak atau jadwal tagihan.</p>
    {canPost && !data.journal && <Button size="sm" onClick={() => { setOpen(true); setError(""); }}>Bukukan pokok Excel</Button>}
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bukukan saldo awal pokok Excel</DialogTitle>
          <DialogDescription>
            Catat {formatRupiahRinci(data.excelAmount)} per {formatTanggalPendek(data.cutoffDate)}.
            Debit akun {data.receivableCode} dan kredit akun {data.offsetCode}. Selisih {formatRupiahRinci(data.difference)} tetap ditandai untuk ditinjau.
          </DialogDescription>
        </DialogHeader>
        {error && <div role="alert"><FormError error={error} /></div>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Batal</Button>
          <Button disabled={busy} onClick={() => void post()}>{busy ? "Membukukan…" : "Konfirmasi pembukuan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
