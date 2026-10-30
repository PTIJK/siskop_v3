import { useReducer, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateSaleResponse, PosPaymentMethod, Product } from "@siskop/types";
import { createPOSSale, getMemberCreditStatus, getProducts } from "@/api/konsumen";
import { ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { ProductSearchGrid } from "@/components/konsumen/ProductSearchGrid";
import { POSCart, type CartLine } from "@/components/konsumen/POSCart";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { CheckCircle2, ShoppingCart } from "lucide-react";

// ── Cart state — the one deliberate exception to "server state via TanStack
// Query, no new store": the cart is ephemeral, doesn't exist until checkout,
// and is local to this page, so plain useReducer is correct here (not
// Zustand, not TanStack Query). ───────────────────────────────────────────

interface CartState {
  lines: CartLine[];
}

type CartAction =
  | { type: "ADD_ITEM"; product: Product }
  | { type: "REMOVE_ITEM"; productId: string }
  | { type: "SET_QUANTITY"; productId: string; quantity: number }
  | { type: "CLEAR" };

const INITIAL_CART: CartState = { lines: [] };

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const { product } = action;
      const stockLevel = Number(product.stockLevel);
      const existing = state.lines.find((l) => l.productId === product.id);

      if (existing) {
        if (existing.quantity >= stockLevel) return state; // already at/over stock — no-op
        return {
          lines: state.lines.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l))
        };
      }

      if (stockLevel <= 0) return state; // out of stock — no-op

      return {
        lines: [
          ...state.lines,
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            unitPrice: product.sellPrice,
            quantity: 1,
            stockLevel,
            uom: product.uom
          }
        ]
      };
    }

    case "REMOVE_ITEM":
      return { lines: state.lines.filter((l) => l.productId !== action.productId) };

    case "SET_QUANTITY": {
      const clamped = Math.max(0, Math.min(action.quantity, state.lines.find((l) => l.productId === action.productId)?.stockLevel ?? 0));
      if (clamped <= 0) return { lines: state.lines.filter((l) => l.productId !== action.productId) };
      return {
        lines: state.lines.map((l) => (l.productId === action.productId ? { ...l, quantity: clamped } : l))
      };
    }

    case "CLEAR":
      return INITIAL_CART;

    default:
      return state;
  }
}

/**
 * POS (point-of-sale) checkout screen for a KONSUMEN unit — third tab
 * alongside Produk/Stok inside UnitLayout, at /ksu/units/:unitId/pos.
 */
export function POSPage() {
  const { unitId } = useParams<{ unitId: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [cart, dispatch] = useReducer(cartReducer, INITIAL_CART);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("CASH");
  const [receipt, setReceipt] = useState<CreateSaleResponse | null>(null);
  const [creditMember, setCreditMember] = useState<{ id: string; fullName: string } | null>(null);
  // Phone and tablet: the cart and payment live in a bottom sheet opened from a bar with the total.
  const narrow = useMediaQuery("(max-width: 1180px)");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetched here (not inside POSCart) because checkout also needs
  // availableCredit — the mutationFn below reads it via this same query's
  // cache key rather than duplicating the fetch. Cleared alongside the cart
  // on a successful sale and whenever the payment method changes away from
  // MEMBER_CREDIT (see resetPaymentMethod below).
  const { data: creditStatus, isPending: creditStatusPending } = useQuery({
    queryKey: ["konsumen", "credit", creditMember?.id],
    queryFn: () => getMemberCreditStatus(creditMember!.id),
    enabled: Boolean(creditMember)
  });

  function resetPaymentMethod(method: PosPaymentMethod) {
    setPaymentMethod(method);
    if (method !== "MEMBER_CREDIT") setCreditMember(null);
  }

  // Same ["konsumen","products",unitId] key ProductsPage/StockMovementForm
  // use — the grid shares that cache, and checkout invalidates it below so
  // Produk's stock levels reflect the sale immediately afterward.
  const {
    data: products,
    isPending,
    isError,
    error
  } = useQuery({
    queryKey: ["konsumen", "products", unitId],
    queryFn: () => getProducts(unitId as string),
    enabled: Boolean(unitId)
  });

  const checkout = useMutation({
    mutationFn: () => {
      if (!unitId) throw new Error("Unit tidak ditemukan");
      return createPOSSale({
        unitId,
        items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        paymentMethod,
        memberId: paymentMethod === "MEMBER_CREDIT" ? creditMember?.id : undefined
      });
    },
    onSuccess: (sale) => {
      setReceipt(sale);
      setSheetOpen(false);
      dispatch({ type: "CLEAR" });
      resetPaymentMethod("CASH");
      void qc.invalidateQueries({ queryKey: ["konsumen", "products", unitId] });
      // The sale just changed this member's outstanding store-credit balance.
      void qc.invalidateQueries({ queryKey: ["konsumen", "credit", creditMember?.id] });
      toast({ title: "Transaksi berhasil" });
    },
    onError: (err) => {
      toast({
        title: "Transaksi gagal",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  });

  const cartQuantity = (productId: string) => cart.lines.find((l) => l.productId === productId)?.quantity ?? 0;
  const itemCount = cart.lines.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = cart.lines.reduce((sum, l) => sum + parseFloat(l.unitPrice) * l.quantity, 0);

  const cartPanel = (
    <POSCart
      lines={cart.lines}
      paymentMethod={paymentMethod}
      onPaymentMethodChange={resetPaymentMethod}
      creditMemberId={creditMember?.id ?? null}
      creditMemberName={creditMember?.fullName ?? null}
      onCreditMemberChange={setCreditMember}
      creditStatus={creditStatus}
      creditStatusPending={creditStatusPending}
      onIncrement={(productId) => {
        const line = cart.lines.find((l) => l.productId === productId);
        if (line) dispatch({ type: "SET_QUANTITY", productId, quantity: line.quantity + 1 });
      }}
      onDecrement={(productId) => {
        const line = cart.lines.find((l) => l.productId === productId);
        if (line) dispatch({ type: "SET_QUANTITY", productId, quantity: line.quantity - 1 });
      }}
      onRemove={(productId) => dispatch({ type: "REMOVE_ITEM", productId })}
      onCheckout={() => checkout.mutate()}
      isCheckingOut={checkout.isPending}
    />
  );

  return (
    <div className={narrow ? "space-y-5 pb-24" : "space-y-5"}>
      <PageHeader title="Kasir" description="Ketuk produk untuk menambahkannya ke keranjang, lalu bayar." />

      {receipt && (
        <Card role="status" className="border-success/40 bg-success/10">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" />
              <div>
                <p className="text-sm font-extrabold text-foreground">Transaksi #{receipt.id} berhasil</p>
                <p className="text-sm tabular-nums text-muted-foreground">Total dibayar: {formatRupiah(receipt.totalAmount)}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setReceipt(null)}>
              Transaksi baru
            </Button>
          </CardContent>
        </Card>
      )}

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <Card>
          <CardContent role="alert" className="py-6 text-sm font-semibold text-destructive">
            {error instanceof ApiRequestError ? error.message : "Produk belum bisa dimuat. Periksa koneksi, lalu muat ulang halaman."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 min-[1181px]:grid-cols-3">
            <div className="min-[1181px]:col-span-2">
              <ProductSearchGrid
                products={products}
                cartQuantity={cartQuantity}
                onAdd={(product) => dispatch({ type: "ADD_ITEM", product })}
              />
            </div>
            {!narrow && <div className="min-[1181px]:sticky min-[1181px]:top-[84px] min-[1181px]:self-start">{cartPanel}</div>}
          </div>

          {narrow && (
            <>
              <div className="fixed inset-x-0 bottom-0 z-topbar flex items-center gap-3 border-t bg-card p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-muted-foreground">{itemCount} barang</p>
                  <p className="truncate text-lg font-extrabold tabular-nums">{formatRupiah(cartTotal)}</p>
                </div>
                <Button size="lg" className="h-14 min-w-[140px] text-base" disabled={itemCount === 0} onClick={() => setSheetOpen(true)}>
                  <ShoppingCart aria-hidden="true" /> Bayar
                </Button>
              </div>
              <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
                <DrawerContent side="bottom" aria-describedby="pos-sheet-desc">
                  <DrawerHeader>
                    <DrawerTitle>Keranjang dan pembayaran</DrawerTitle>
                    <DrawerDescription id="pos-sheet-desc">Periksa barang, pilih metode pembayaran, lalu bayar.</DrawerDescription>
                  </DrawerHeader>
                  <DrawerBody className="p-3">{cartPanel}</DrawerBody>
                </DrawerContent>
              </Drawer>
            </>
          )}
        </>
      )}
    </div>
  );
}
