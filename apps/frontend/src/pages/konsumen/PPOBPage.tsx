import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import type { CheckPPOBBillResponse, PayPPOBBillResponse, PpobBillType } from "@siskop/types";
import { checkPPOBBill, payPPOBBill } from "@/api/konsumen";
import { ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

const BILL_TYPE_LABEL: Record<PpobBillType, string> = {
  LISTRIK: "Listrik",
  PULSA: "Pulsa",
  BPJS: "BPJS",
  AIR: "Air"
};

const BILL_TYPES: PpobBillType[] = ["LISTRIK", "PULSA", "BPJS", "AIR"];

/**
 * PPOB (bayar tagihan) screen for a KONSUMEN unit — fourth tab alongside
 * Produk/Stok/POS inside UnitLayout, at /ksu/units/:unitId/ppob.
 *
 * Backed entirely by ppob.service.ts's deterministic *simulation* — there is
 * no real biller integration (see the notice below, which is a hard
 * requirement, not decoration: this screen must read as an obvious stub to
 * anyone using it, never as production-ready).
 *
 * "Cek tagihan" and "Bayar tagihan" are two separate calls (check is a pure
 * read with no side effect; pay is the one that writes a PPOBTransaction
 * row), so a stale check must never authorize a payment for a different
 * customer number than the one it was quoted for. `checkedKey` records the
 * exact (billType, customerNumber) pair the last successful check was for;
 * "Bayar tagihan" only enables when the CURRENT form values still match that
 * key. Editing either field after a successful check changes the current
 * key, the equality check fails, and the button re-disables immediately —
 * no explicit "invalidate" step needed, it falls out of the comparison.
 */
export function PPOBPage() {
  const { unitId } = useParams<{ unitId: string }>();
  const { toast } = useToast();

  const [billType, setBillType] = useState<PpobBillType>("LISTRIK");
  const [customerNumber, setCustomerNumber] = useState("");
  const [checkResult, setCheckResult] = useState<CheckPPOBBillResponse | null>(null);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PayPPOBBillResponse | null>(null);

  const currentKey = `${billType}:${customerNumber}`;
  const isCheckStale = checkedKey !== currentKey;

  const check = useMutation({
    mutationFn: () => {
      if (!unitId) throw new Error("Unit tidak ditemukan");
      return checkPPOBBill({ unitId, billType, customerNumber });
    },
    onSuccess: (result) => {
      setCheckResult(result);
      setCheckedKey(currentKey);
      setReceipt(null);
    },
    onError: () => {
      setCheckResult(null);
      setCheckedKey(null);
    }
  });

  const pay = useMutation({
    mutationFn: () => {
      if (!unitId) throw new Error("Unit tidak ditemukan");
      if (!checkResult) throw new Error("Cek tagihan terlebih dahulu");
      return payPPOBBill({ unitId, billType, customerNumber, adminFee: checkResult.adminFee });
    },
    onSuccess: (result) => {
      setReceipt(result);
      setCheckResult(null);
      setCheckedKey(null);
      setCustomerNumber("");
      toast({ title: "Pembayaran berhasil" });
    },
    onError: (err) => {
      toast({
        title: "Pembayaran gagal",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  });

  const canPay = Boolean(checkResult) && !isCheckStale && !pay.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title="PPOB" description="Bayar tagihan listrik, pulsa, BPJS, dan air" />

      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Menggunakan penyedia simulasi — integrasi penyedia riil akan ditambahkan kemudian.</p>
      </div>

      {receipt && (
        <Card className="border-green-600/30 bg-green-50 dark:bg-green-950/20">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="text-sm font-medium text-foreground">Transaksi #{receipt.id} berhasil</p>
                <p className="text-sm text-muted-foreground">Status: {receipt.status}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setReceipt(null)}>
              Tutup
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 py-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ppob-bill-type">Jenis Tagihan</Label>
              <Select
                value={billType}
                onValueChange={(v) => {
                  setBillType(v as PpobBillType);
                  setReceipt(null);
                }}
              >
                <SelectTrigger id="ppob-bill-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILL_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {BILL_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ppob-customer-number">Nomor Pelanggan</Label>
              <Input
                id="ppob-customer-number"
                value={customerNumber}
                onChange={(e) => {
                  setCustomerNumber(e.target.value);
                  setReceipt(null);
                }}
                placeholder="Contoh: 123456789"
              />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={!unitId || !customerNumber.trim() || check.isPending}
            onClick={() => check.mutate()}
          >
            {check.isPending ? "Memeriksa..." : "Cek tagihan"}
          </Button>

          {check.isError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{check.error instanceof ApiRequestError ? check.error.message : "Gagal memeriksa tagihan"}</p>
            </div>
          )}

          {checkResult && !isCheckStale && (
            <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/40 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Nama Pelanggan</p>
                <p className="text-sm font-medium text-foreground">{checkResult.customerName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tagihan</p>
                <p className="text-sm font-medium text-foreground">{formatRupiah(checkResult.amount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Biaya Admin</p>
                <p className="text-sm font-medium text-foreground">{formatRupiah(checkResult.adminFee)}</p>
              </div>
            </div>
          )}

          <Button type="button" disabled={!canPay} onClick={() => pay.mutate()}>
            {pay.isPending ? "Memproses..." : "Bayar tagihan"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
