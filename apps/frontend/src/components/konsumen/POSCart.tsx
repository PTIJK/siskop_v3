import type { PosPaymentMethod } from "@siskop/types";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

/** One line in the in-memory POS cart — see POSPage's cart reducer. */
export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  /** Product.sellPrice, Decimal-as-string — only ever passed to formatRupiah, never arithmetic on the string itself. */
  unitPrice: string;
  quantity: number;
  /** Product.stockLevel at the time it was added — caps further increments. */
  stockLevel: number;
  uom: string;
}

const PAYMENT_METHOD_LABEL: Record<PosPaymentMethod, string> = {
  CASH: "Tunai",
  TRANSFER: "Transfer",
  MEMBER_CREDIT: "Kredit Anggota"
};

const PAYMENT_METHODS: PosPaymentMethod[] = ["CASH", "TRANSFER", "MEMBER_CREDIT"];

export function POSCart({
  lines,
  paymentMethod,
  onPaymentMethodChange,
  onIncrement,
  onDecrement,
  onRemove,
  onCheckout,
  isCheckingOut
}: {
  lines: CartLine[];
  paymentMethod: PosPaymentMethod;
  onPaymentMethodChange: (method: PosPaymentMethod) => void;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  isCheckingOut: boolean;
}) {
  const total = lines.reduce((sum, line) => sum + parseFloat(line.unitPrice) * line.quantity, 0);
  const isEmpty = lines.length === 0;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShoppingCart className="h-4 w-4" />
          Keranjang
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        {isEmpty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada produk di keranjang</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line) => {
              const atMax = line.quantity >= line.stockLevel;
              return (
                <div key={line.productId} className="flex items-start justify-between gap-2 border-b pb-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{line.name}</p>
                    <p className="text-xs text-muted-foreground">{formatRupiah(line.unitPrice)} / {line.uom}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onDecrement(line.productId)}
                      aria-label={`Kurangi ${line.name}`}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={atMax}
                      onClick={() => onIncrement(line.productId)}
                      aria-label={`Tambah ${line.name}`}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => onRemove(line.productId)}
                      aria-label={`Hapus ${line.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Metode Pembayaran</Label>
          <RadioGroup
            value={paymentMethod}
            onValueChange={(v) => onPaymentMethodChange(v as PosPaymentMethod)}
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {PAYMENT_METHODS.map((method) => (
              <div key={method} className="flex items-center gap-2 rounded-md border p-2">
                <RadioGroupItem value={method} id={`payment-${method}`} />
                <Label htmlFor={`payment-${method}`} className="cursor-pointer text-sm font-normal">
                  {PAYMENT_METHOD_LABEL[method]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4">
        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total</span>
          <span className="text-primary">{formatRupiah(total)}</span>
        </div>
        {isEmpty && <p className="text-xs text-muted-foreground">Tambahkan produk ke keranjang sebelum membayar.</p>}
        <Button className="w-full" size="lg" disabled={isEmpty || isCheckingOut} onClick={onCheckout}>
          {isCheckingOut ? "Memproses..." : "Bayar"}
        </Button>
      </CardFooter>
    </Card>
  );
}
