import { RupiahInput } from "@/components/ui/rupiah-input";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { CreditCard } from "lucide-react";

interface LoanDetail {
  id: string;
  member: { id: string; fullName: string; memberId: string; accountNumber: string };
  loanConfig: { name: string; type: string; rateType: string; rate: string };
  principalAmount: string;
  totalAmount: string;
  monthlyPayment: string;
  remainingAmount: string;
  termMonths: number;
  installmentFrequency: "DAILY" | "WEEKLY" | "MONTHLY";
  rate?: string | null;
  rateNote?: string | null;
  notes?: string | null;
  status: string;
  kolCategory: string;
  daysOverdue: number;
  disbursedAt?: string;
  payments: {
    id: string;
    amount: string;
    penalty: string;
    note?: string;
    paidAt: string;
    createdByUser?: { name: string };
  }[];
  installments: {
    id: string;
    seq: number;
    dueDate: string;
    principalDue: string;
    interestDue: string;
    principalPaid: string;
    interestPaid: string;
    status: "UNPAID" | "PARTIAL" | "PAID";
  }[];
}

const FREQUENCY_LABEL: Record<LoanDetail["installmentFrequency"], string> = {
  DAILY: "Harian",
  WEEKLY: "Mingguan",
  MONTHLY: "Bulanan"
};

const INSTALLMENT_STATUS_VARIANT: Record<LoanDetail["installments"][number]["status"], "default" | "secondary" | "outline"> = {
  PAID: "default",
  PARTIAL: "secondary",
  UNPAID: "outline"
};

export function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [payDialog, setPayDialog] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [penalty, setPenalty] = useState("0");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payNote, setPayNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: loan, isPending } = useQuery({
    queryKey: ["loans", id],
    queryFn: () => apiFetch<LoanDetail>(`/loans/${id}`)
  });

  useEffect(() => {
    if (!loan) return;
    // Default to the oldest unpaid/partial installment's remaining amount when a
    // schedule exists; monthlyPayment is the only thing a pre-F2, unbackfilled loan has.
    const nextInstallment = loan.installments.find((i) => i.status !== "PAID");
    if (nextInstallment) {
      const remaining =
        Number(nextInstallment.principalDue) +
        Number(nextInstallment.interestDue) -
        Number(nextInstallment.principalPaid) -
        Number(nextInstallment.interestPaid);
      setPayAmount(remaining.toFixed(2));
    } else if (loan.monthlyPayment) {
      setPayAmount(loan.monthlyPayment);
    }
  }, [loan]);

  const handlePayment = async () => {
    if (!loan) return;
    setIsSubmitting(true);
    try {
      await apiPost(`/loans/${id}/pay`, {
        amount: parseFloat(payAmount),
        penalty: parseFloat(penalty) || 0,
        paidAt: payDate,
        note: payNote || undefined
      });
      toast({ title: "Pembayaran berhasil dicatat" });
      setPayDialog(false);
      await queryClient.invalidateQueries({ queryKey: ["loans", id] });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal", description: message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isPending) return <PageLoading />;
  if (!loan) {
    return (
      <div className="space-y-5">
        <PageHeader title="Pinjaman" breadcrumb={[{ label: "Pinjaman", href: "/loans" }, { label: "Pinjaman" }]} />
        <Card>
          <CardContent>
            <EmptyState title="Pinjaman tidak ditemukan" description="Tautannya mungkin sudah tidak berlaku, atau datanya sudah dihapus. Kembali ke daftar untuk memilih lagi." action={<Button asChild variant="outline"><Link to="/loans">Kembali ke daftar</Link></Button>} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const principal = parseFloat(loan.principalAmount);
  const total = parseFloat(loan.totalAmount);
  const marginTotal = Math.max(0, total - principal);
  const remaining = parseFloat(loan.remainingAmount);
  const paid = loan.payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const progressBase = remaining + paid;
  const progress = progressBase > 0 ? Math.min(100, Math.round((paid / progressBase) * 100)) : 0;
  const marginLabel = loan.loanConfig.rateType === "MARGIN"
    ? "Infaq / Margin"
    : loan.loanConfig.rateType === "BAGI_HASIL"
      ? "Bagi Hasil / Infaq"
      : "Infaq / Margin / Bunga";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Detail pinjaman"
        breadcrumb={[{ label: "Pinjaman", href: "/loans" }, { label: loan.loanConfig.name }]}
        actions={
          loan.status === "ACTIVE" && can("loans", "update") ? (
            <Button variant="brand" onClick={() => setPayDialog(true)}>
              <CreditCard className="h-4 w-4" /> Catat Pembayaran
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <h2 className="text-xl font-extrabold tracking-tight">{loan.member.fullName}</h2>
              <p className="font-mono text-sm text-muted-foreground">{loan.member.memberId}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant="accent">{loan.loanConfig.name}</Badge>
                <Badge variant="outline">{loan.status}</Badge>
                <Badge variant="outline">{FREQUENCY_LABEL[loan.installmentFrequency]} · {loan.termMonths} bln</Badge>
                <KOLBadge category={loan.kolCategory} />
              </div>
            </div>
            <div className="space-y-1 text-sm text-muted-foreground sm:text-right">
              {loan.disbursedAt && <p>Tanggal cair: <span className="font-semibold text-foreground">{formatTanggalPendek(loan.disbursedAt)}</span></p>}
              {loan.rateNote && loan.rate != null && (
                <p>Tarif: <span className="font-semibold text-foreground">{loan.rate}%</span> ({loan.rateNote})</p>
              )}
              {loan.notes && <p>Catatan: <span className="text-foreground">{loan.notes}</span></p>}
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-muted/35 p-4">
              <dt className="text-sm font-semibold text-muted-foreground">Pokok</dt>
              <dd className="money mt-1 text-xl font-extrabold">{formatRupiah(loan.principalAmount)}</dd>
            </div>
            <div className="rounded-xl border bg-accent/60 p-4">
              <dt className="text-sm font-semibold text-accent-foreground">{marginLabel}</dt>
              <dd className="money mt-1 text-xl font-extrabold text-accent-foreground">{formatRupiah(marginTotal)}</dd>
            </div>
            <div className="rounded-xl border bg-muted/35 p-4">
              <dt className="text-sm font-semibold text-muted-foreground">Total Kewajiban</dt>
              <dd className="money mt-1 text-xl font-extrabold">{formatRupiah(loan.totalAmount)}</dd>
            </div>
            <div className="rounded-xl border bg-muted/35 p-4">
              <dt className="text-sm font-semibold text-muted-foreground">Angsuran / bln</dt>
              <dd className="money mt-1 text-xl font-extrabold">{formatRupiah(loan.monthlyPayment)}</dd>
            </div>
          </dl>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Sudah dibayar: <strong className="money text-foreground">{formatRupiah(paid)}</strong></span>
              <span className="font-bold text-warning">Sisa: <span className="money">{formatRupiah(remaining)}</span></span>
            </div>
            <Progress value={progress} className="h-2.5" />
            <p className="mt-1.5 text-right text-sm font-semibold text-muted-foreground">{progress}% lunas</p>
          </div>
        </CardContent>
      </Card>

      {loan.installments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Jadwal Cicilan</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Jatuh Tempo</TableHead>
                  <TableHead className="text-right">Pokok</TableHead>
                  <TableHead className="text-right">{marginLabel}</TableHead>
                  <TableHead className="text-right">Total Tagihan</TableHead>
                  <TableHead className="text-right">Terbayar</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.installments.map((inst) => (
                  <TableRow key={inst.id}>
                    <TableCell className="font-semibold">{inst.seq}</TableCell>
                    <TableCell>{formatTanggalPendek(inst.dueDate)}</TableCell>
                    <TableCell className="money text-right">{formatRupiah(inst.principalDue)}</TableCell>
                    <TableCell className="money text-right text-muted-foreground">{formatRupiah(inst.interestDue)}</TableCell>
                    <TableCell className="money text-right font-semibold">
                      {formatRupiah(Number(inst.principalDue) + Number(inst.interestDue))}
                    </TableCell>
                    <TableCell className="money text-right">
                      {formatRupiah(Number(inst.principalPaid) + Number(inst.interestPaid))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={INSTALLMENT_STATUS_VARIANT[inst.status]}>{inst.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead className="text-right">Denda</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead>Petugas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loan.payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Belum ada riwayat pembayaran
                  </TableCell>
                </TableRow>
              ) : (
                loan.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatTanggalPendek(p.paidAt)}</TableCell>
                    <TableCell className="text-right font-semibold text-success">{formatRupiah(p.amount)}</TableCell>
                    <TableCell className="text-right text-destructive">{formatRupiah(p.penalty)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.note ?? "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.createdByUser?.name ?? "-"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={payDialog} onOpenChange={(o) => !o && setPayDialog(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Catat Pembayaran</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="loan-payment-amount">Nominal bayar (Rp)</Label>
              <RupiahInput id="loan-payment-amount" value={payAmount} onValueChange={setPayAmount} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loan-late-fee">Denda (Rp, jika ada)</Label>
              <RupiahInput id="loan-late-fee" value={penalty} onValueChange={setPenalty} />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal Bayar</Label>
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea rows={2} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(false)}>
              Batal
            </Button>
            <Button onClick={handlePayment} disabled={isSubmitting || !payAmount}>
              {isSubmitting ? "Memproses..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
