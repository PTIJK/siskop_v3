import { useState } from "react";
import type { MarkInvoicePaidInput, MarkInvoicePaidResult, PaymentMethod, PlatformInvoice } from "@siskop/types";
import { apiPost } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { formatRupiah } from "@/lib/format";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "../pricing/pricingUi";
import { paidAtFromInput, todayInputValue } from "./invoiceAdmin";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Transfer bank" },
  { value: "CASH", label: "Tunai" },
  { value: "OTHER", label: "Lainnya" }
];

/** Confirms that the money for one invoice has arrived. The amount is always the invoice total. */
export function MarkPaidDialog({ invoice, onClose, onDone }: { invoice: PlatformInvoice | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const close = () => {
    setMethod("BANK_TRANSFER");
    setReference("");
    setPaidOn("");
    setError("");
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    setError("");
    setSaving(true);
    try {
      const paidAt = paidAtFromInput(paidOn);
      const body: MarkInvoicePaidInput = {
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(paidAt ? { paidAt } : {})
      };
      const res = await apiPost<MarkInvoicePaidResult>(`/platform/invoices/${invoice.id}/mark-paid`, body);
      toast({
        title: res.alreadyPaid ? "Faktur sudah lunas sebelumnya" : "Pembayaran dicatat",
        description: res.alreadyPaid ? undefined : `${invoice.tenant.name} sekarang aktif.`
      });
      close();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={invoice !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tandai lunas</DialogTitle>
          <DialogDescription>
            {invoice && `${invoice.number} · ${invoice.tenant.name} · ${formatRupiah(invoice.total)}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pay-method">Metode pembayaran</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="pay-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-reference">Referensi (opsional)</Label>
            <Input id="pay-reference" value={reference} maxLength={100} placeholder="Nomor bukti transfer" onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pay-date">Tanggal uang diterima</Label>
            <Input id="pay-date" type="date" value={paidOn} max={todayInputValue()} onChange={(e) => setPaidOn(e.target.value)} />
            <p className="text-xs text-muted-foreground">Kosongkan jika diterima hari ini. Tanggal ini menjadi awal masa langganan.</p>
          </div>
          <FormError error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan..." : "Catat pembayaran"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
