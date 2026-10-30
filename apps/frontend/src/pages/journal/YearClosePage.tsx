import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, LockOpen } from "lucide-react";
import type { YearCloseList, YearCloseListItem, YearClosePlan, YearCloseStatus } from "@siskop/types";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { formatRupiah, formatRupiahOrDash, formatTanggalIndonesia } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const KEY = ["journal", "year-close"] as const;

const STATUS_LABEL: Record<YearCloseStatus, { label: string; variant: "info" | "ok" | "warn" }> = {
  OPEN: { label: "Terbuka", variant: "info" },
  CLOSED: { label: "Ditutup", variant: "ok" },
  REOPENED: { label: "Dibuka kembali", variant: "warn" }
};

export function YearClosePage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canClose = can("accounting", "update");

  const { data, isPending, isError, refetch } = useQuery({ queryKey: KEY, queryFn: () => apiFetch<YearCloseList>("/journal/year-close") });
  // Closing the books is the one irreversible-feeling action here: the year must be typed to confirm.
  const [typedYear, setTypedYear] = useState("");

  const [previewYear, setPreviewYear] = useState<number | null>(null);
  const [reopenTarget, setReopenTarget] = useState<YearCloseListItem | null>(null);
  const [error, setError] = useState("");

  const preview = useQuery({
    queryKey: [...KEY, "preview", previewYear],
    queryFn: () => apiFetch<YearClosePlan>(`/journal/year-close/${previewYear}/preview`),
    enabled: previewYear !== null,
    retry: false
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const fail = (err: unknown) => setError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");

  const close = useMutation({
    mutationFn: (year: number) => apiPost(`/journal/year-close/${year}`, {}),
    onSuccess: (_r, year) => {
      toast({ title: `Buku tahun ${year} ditutup` });
      setPreviewYear(null);
      setTypedYear("");
      void refresh();
    },
    onError: fail
  });
  const reopen = useMutation({
    mutationFn: (year: number) => apiPost(`/journal/year-close/${year}/reopen`, {}),
    onSuccess: (_r, year) => {
      toast({ title: `Buku tahun ${year} dibuka kembali` });
      setReopenTarget(null);
      void refresh();
    },
    onError: (err) => {
      setReopenTarget(null);
      toast({ title: "Gagal membuka kembali", description: err instanceof ApiRequestError ? err.message : undefined, variant: "destructive" });
    }
  });

  if (isPending) return <PageLoading />;

  const plan = preview.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tutup buku"
        description="Pindahkan hasil usaha tahun berjalan ke ekuitas. Setelah ditutup, tahun berikutnya dibuka dengan akun pendapatan dan beban bernilai nol."
      />

      <Card>
        <CardContent className="pt-5">
          {isError || !data ? (
            <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm font-semibold text-destructive">Daftar tahun buku belum bisa dimuat.</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Coba lagi
              </Button>
            </div>
          ) : data.years.length === 0 ? (
            <EmptyState title="Belum ada tahun buku yang bisa ditutup" description="Tahun buku muncul di sini setelah tahunnya berakhir dan ada transaksi yang tercatat." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tahun buku</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Terakhir diubah</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.years.map((y) => {
                  const s = STATUS_LABEL[y.status];
                  const stamp = y.reopenedAt ?? y.closedAt;
                  return (
                    <TableRow key={y.year}>
                      <TableCell className="font-medium tabular-nums">{y.year}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{stamp ? formatTanggalIndonesia(stamp) : "-"}</TableCell>
                      <TableCell className="text-right">
                        {canClose &&
                          (y.status === "CLOSED" ? (
                            <Button variant="outline" size="sm" onClick={() => setReopenTarget(y)}>
                              <LockOpen aria-hidden="true" />
                              Buka kembali
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setError("");
                                setPreviewYear(y.year);
                              }}
                            >
                              <CalendarCheck aria-hidden="true" />
                              Tutup buku
                            </Button>
                          ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewYear !== null} onOpenChange={(open) => { if (!open) { setPreviewYear(null); setTypedYear(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tutup buku tahun {previewYear}</DialogTitle>
            <DialogDescription>Jurnal penutup berikut akan dicatat per unit pada 31 Desember {previewYear}.</DialogDescription>
          </DialogHeader>

          {preview.isPending ? (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">Menyiapkan pratinjau…</p>
          ) : preview.isError ? (
            <FormError error={preview.error instanceof ApiRequestError ? preview.error.message : "Gagal memuat pratinjau"} />
          ) : plan ? (
            <div className="max-h-[50vh] space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span>
                  SHU tahun {plan.year} → {plan.targetAccount.code} {plan.targetAccount.name}
                </span>
                <span className="font-semibold tabular-nums">{formatRupiah(plan.netIncome)}</span>
              </div>
              {plan.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada pendapatan atau beban pada tahun ini; tidak ada jurnal yang dicatat, tahun hanya ditandai ditutup.</p>
              ) : (
                plan.entries.map((e) => (
                  <div key={e.unitId ?? "unallocated"} className="space-y-1">
                    <p className="text-sm font-medium">{e.unitName ?? "Tidak dialokasikan ke unit"}</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Akun</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Kredit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {e.lines.map((l) => (
                          <TableRow key={l.accountId}>
                            <TableCell>
                              {l.accountCode} — {l.accountName}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatRupiahOrDash(l.debit)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatRupiahOrDash(l.credit)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))
              )}
              <p className="text-xs text-muted-foreground">
                Jurnal manual pada tahun {plan.year} akan dikunci. Anda tetap dapat membuka kembali tahun ini; jurnal pembalik akan dicatat.
              </p>
            </div>
          ) : null}

          {plan && (
            <div className="space-y-3 rounded-[12px] border border-destructive/40 bg-destructive/10 p-3">
              <p className="text-sm font-bold">Yang akan terjadi</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                <li>Pendapatan dan beban tahun {plan.year} dinolkan dan hasilnya dipindahkan ke ekuitas.</li>
                <li>Jurnal manual bertanggal {plan.year} dikunci dan tidak bisa ditambah lagi.</li>
                <li>Tahun ini bisa dibuka kembali nanti, tetapi lewat jurnal pembalik yang tercatat permanen.</li>
              </ul>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-year">Ketik {plan.year} untuk mengonfirmasi</Label>
                <Input id="confirm-year" inputMode="numeric" autoComplete="off" value={typedYear} onChange={(e) => setTypedYear(e.target.value)} className="max-w-[160px] tabular-nums" />
              </div>
            </div>
          )}

          <FormError error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPreviewYear(null); setTypedYear(""); }}>
              Batal
            </Button>
            <Button variant="destructive" disabled={!plan || close.isPending || typedYear.trim() !== String(previewYear)} loading={close.isPending} onClick={() => previewYear !== null && close.mutate(previewYear)}>
              {close.isPending ? "Menutup…" : `Tutup buku ${previewYear}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={reopenTarget !== null}
        onOpenChange={(open) => !open && setReopenTarget(null)}
        title={`Buka kembali tahun ${reopenTarget?.year}?`}
        description="Jurnal pembalik dicatat sehingga pendapatan dan beban tahun ini kembali terbuka. Jurnal penutup lama tetap tersimpan sebagai jejak audit."
        confirmLabel="Buka kembali"
        variant="destructive"
        isLoading={reopen.isPending}
        onConfirm={() => { if (reopenTarget) reopen.mutate(reopenTarget.year); }}
      />
    </div>
  );
}
