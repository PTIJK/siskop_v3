import { useState } from "react";
import { ApiRequestError } from "@/api/client";
import { recordCreditRepayment } from "@/api/konsumen";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface CreditRepaymentDialogProps {
  memberId: string;
  outstandingBalance: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a repayment posts successfully, so the caller can invalidate/refetch whatever list or detail it's showing. */
  onSuccess: () => void;
}

/**
 * "Bayar Kredit Toko" dialog — extracted out of MemberDetailPage's Kredit
 * Toko tab (its original home) once PiutangAnggotaPage needed the exact same
 * repayment flow for its list rows. Both callers own their own `open` state
 * and refetch strategy; this component only owns the amount input and the
 * POST itself.
 */
export function CreditRepaymentDialog({ memberId, outstandingBalance, open, onOpenChange, onSuccess }: CreditRepaymentDialogProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setAmount("");
      setError("");
    }
  }

  async function handleSubmit() {
    setError("");
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError("Jumlah harus lebih dari 0");
      return;
    }
    setIsSubmitting(true);
    try {
      await recordCreditRepayment({ memberId, amount: value });
      toast({ title: "Pembayaran kredit dicatat" });
      handleOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Bayar Kredit Toko</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sisa kredit saat ini: <span className="font-medium text-foreground">{formatRupiah(outstandingBalance)}</span>
          </p>
          <div className="space-y-1.5">
            <Label>Jumlah Pembayaran (Rp)</Label>
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Memproses..." : "Bayar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
