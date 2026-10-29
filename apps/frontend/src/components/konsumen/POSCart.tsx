import { useState } from "react";
import type { CreditMemberSearchResult, MemberCreditStatus, PosPaymentMethod } from "@siskop/types";
import { searchCreditMembers } from "@/api/konsumen";
import { ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Minus, Plus, ShoppingCart, Trash2, Search, CheckCircle, XCircle } from "lucide-react";

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

/**
 * Member lookup + eligibility display for "Kredit Anggota" — mirrors the
 * search/select/eligibility-badge pattern pages/loans/NewLoanPage.tsx already
 * uses, but against credit.routes.ts (konsumen:read) rather than /members
 * (members:read), since a Kasir role typically has the former but not the
 * latter. `status` is fetched by the parent (POSPage) since it also needs
 * `availableCredit` to decide whether the cart total fits — this component
 * only owns the transient search-box state.
 */
function MemberCreditFields({
  memberId,
  memberName,
  onSelect,
  status,
  statusPending
}: {
  memberId: string | null;
  memberName: string | null;
  onSelect: (member: { id: string; fullName: string } | null) => void;
  status?: MemberCreditStatus;
  statusPending: boolean;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CreditMemberSearchResult[]>([]);
  const [searchError, setSearchError] = useState("");

  async function runSearch(q: string) {
    setSearch(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      setResults(await searchCreditMembers(q));
    } catch (err) {
      setSearchError(err instanceof ApiRequestError ? err.message : "Gagal mencari anggota");
    }
  }

  if (memberId) {
    return (
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium">{memberName}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>
            Ganti
          </Button>
        </div>
        {statusPending ? (
          <p className="text-xs text-muted-foreground">Memeriksa kelayakan...</p>
        ) : status ? (
          <div className="space-y-1 text-xs">
            <div className={`flex items-center gap-1.5 font-semibold ${status.eligible ? "text-success" : "text-destructive"}`}>
              {status.eligible ? <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              {status.eligible ? "Layak menggunakan kredit anggota" : "Tidak memenuhi syarat kredit anggota"}
            </div>
            {!status.hasActiveSaving && <p className="text-muted-foreground">Anggota belum memiliki simpanan aktif.</p>}
            <p className="text-muted-foreground">
              Sisa limit: <span className="font-medium text-foreground">{formatRupiah(status.availableCredit)}</span> dari{" "}
              {formatRupiah(status.creditLimit)}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-[13px] h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
        <Input placeholder="Cari nama anggota..." aria-label="Cari anggota kredit" className="pl-10" value={search} onChange={(e) => void runSearch(e.target.value)} />
        {results.length > 0 && (
          <div className="absolute z-popover mt-1 w-full overflow-hidden rounded-[14px] border bg-card shadow-md">
            {results.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex min-h-[56px] w-full flex-col items-start justify-center px-4 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() => {
                  onSelect({ id: m.id, fullName: m.fullName });
                  setSearch("");
                  setResults([]);
                }}
              >
                <span className="text-sm font-medium">{m.fullName}</span>
                <span className="font-mono text-xs text-muted-foreground">{m.memberId}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {searchError && <p role="alert" className="text-xs font-semibold text-destructive">{searchError}</p>}
    </div>
  );
}

export function POSCart({
  lines,
  paymentMethod,
  onPaymentMethodChange,
  creditMemberId,
  creditMemberName,
  onCreditMemberChange,
  creditStatus,
  creditStatusPending,
  onIncrement,
  onDecrement,
  onRemove,
  onCheckout,
  isCheckingOut
}: {
  lines: CartLine[];
  paymentMethod: PosPaymentMethod;
  onPaymentMethodChange: (method: PosPaymentMethod) => void;
  creditMemberId: string | null;
  creditMemberName: string | null;
  onCreditMemberChange: (member: { id: string; fullName: string } | null) => void;
  creditStatus?: MemberCreditStatus;
  creditStatusPending: boolean;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  isCheckingOut: boolean;
}) {
  const total = lines.reduce((sum, line) => sum + parseFloat(line.unitPrice) * line.quantity, 0);
  const isEmpty = lines.length === 0;

  const isMemberCredit = paymentMethod === "MEMBER_CREDIT";
  const creditInsufficient = isMemberCredit && creditStatus !== undefined && parseFloat(creditStatus.availableCredit) < total;
  const creditBlocked = isMemberCredit && (!creditMemberId || (!creditStatusPending && (!creditStatus?.eligible || creditInsufficient)));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-[18px] w-[18px]" aria-hidden="true" />
          Keranjang
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        {isEmpty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Keranjang masih kosong. Ketuk produk untuk menambahkannya.</p>
        ) : (
          <div className="space-y-3">
            {lines.map((line) => {
              const atMax = line.quantity >= line.stockLevel;
              return (
                <div key={line.productId} className="flex items-start justify-between gap-2 border-b pb-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{line.name}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{formatRupiah(line.unitPrice)} / {line.uom}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 max-[900px]:h-11 max-[900px]:w-11"
                      onClick={() => onDecrement(line.productId)}
                      aria-label={`Kurangi ${line.name}`}
                    >
                      <Minus aria-hidden="true" />
                    </Button>
                    <span className="w-7 text-center text-sm font-extrabold tabular-nums">{line.quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 max-[900px]:h-11 max-[900px]:w-11"
                      disabled={atMax}
                      onClick={() => onIncrement(line.productId)}
                      aria-label={`Tambah ${line.name}`}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive hover:text-destructive max-[900px]:h-11 max-[900px]:w-11"
                      onClick={() => onRemove(line.productId)}
                      aria-label={`Hapus ${line.name}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-1.5">
          <Label id="payment-label">Metode pembayaran</Label>
          <RadioGroup
            value={paymentMethod}
            onValueChange={(v) => onPaymentMethodChange(v as PosPaymentMethod)}
            aria-labelledby="payment-label"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {PAYMENT_METHODS.map((method) => (
              <div key={method} className="flex min-h-11 items-center gap-2 rounded-[10px] border px-3 py-2 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary">
                <RadioGroupItem value={method} id={`payment-${method}`} />
                <Label htmlFor={`payment-${method}`} className="flex-1 cursor-pointer text-sm font-semibold">
                  {PAYMENT_METHOD_LABEL[method]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {isMemberCredit && (
          <div className="space-y-1.5">
            <Label>Anggota pemakai kredit</Label>
            <MemberCreditFields
              memberId={creditMemberId}
              memberName={creditMemberName}
              onSelect={onCreditMemberChange}
              status={creditStatus}
              statusPending={creditStatusPending}
            />
            {creditMemberId && !creditStatusPending && creditStatus?.eligible && creditInsufficient && (
              <p role="alert" className="text-xs font-semibold text-destructive">Total keranjang melebihi sisa limit kredit anggota.</p>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col items-stretch gap-3 border-t pt-4">
        <div className="flex items-center justify-between text-base font-extrabold">
          <span>Total</span>
          <span className="text-[22px] tabular-nums">{formatRupiah(total)}</span>
        </div>
        {isEmpty && <p className="text-xs text-muted-foreground">Tambahkan produk ke keranjang sebelum membayar.</p>}
        <Button className="h-14 w-full text-base" size="lg" disabled={isEmpty || isCheckingOut || creditBlocked} loading={isCheckingOut} onClick={onCheckout}>
          {isCheckingOut ? "Memproses…" : "Bayar"}
        </Button>
      </CardFooter>
    </Card>
  );
}
