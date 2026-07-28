import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/shared/PageHeader";
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
}

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
    if (loan?.monthlyPayment) setPayAmount(loan.monthlyPayment);
  }, [loan?.monthlyPayment]);

  const handlePayment = async () => {
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
  if (!loan) return <p className="text-center text-muted-foreground">Pinjaman tidak ditemukan</p>;

  const total = parseFloat(loan.totalAmount);
  const remaining = parseFloat(loan.remainingAmount);
  const paid = total - remaining;
  const progress = total > 0 ? Math.round((paid / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Detail Pinjaman" breadcrumb={[{ label: "Pinjaman", href: "/loans" }, { label: loan.loanConfig.name }]} />

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">{loan.member.fullName}</p>
              <p className="font-mono text-xs text-muted-foreground">{loan.member.memberId}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge>{loan.loanConfig.name}</Badge>
                <Badge variant="outline">{loan.status}</Badge>
                <KOLBadge category={loan.kolCategory} />
              </div>
              {loan.disbursedAt && <p className="mt-2 text-xs text-muted-foreground">Cair: {formatTanggalPendek(loan.disbursedAt)}</p>}
            </div>
            <div className="space-y-3">
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Pokok</dt>
                  <dd className="font-semibold">{formatRupiah(loan.principalAmount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd className="font-semibold">{formatRupiah(loan.totalAmount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Angsuran</dt>
                  <dd className="font-semibold">{formatRupiah(loan.monthlyPayment)}</dd>
                </div>
              </dl>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span>Dibayar: {formatRupiah(paid)}</span>
                  <span className="text-orange-600">Sisa: {formatRupiah(remaining)}</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="mt-0.5 text-right text-xs text-muted-foreground">{progress}% lunas</p>
              </div>
            </div>
          </div>

          {loan.status === "ACTIVE" && can("loans", "update") && (
            <div className="mt-4 border-t pt-4">
              <Button onClick={() => setPayDialog(true)}>
                <CreditCard className="mr-2 h-4 w-4" /> Catat Pembayaran
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
                    <TableCell className="text-right font-semibold text-green-700">{formatRupiah(p.amount)}</TableCell>
                    <TableCell className="text-right text-red-600">{formatRupiah(p.penalty)}</TableCell>
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
              <Label>Nominal Bayar</Label>
              <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} min="1" />
            </div>
            <div className="space-y-1.5">
              <Label>Denda (jika ada)</Label>
              <Input type="number" value={penalty} onChange={(e) => setPenalty(e.target.value)} min="0" />
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
