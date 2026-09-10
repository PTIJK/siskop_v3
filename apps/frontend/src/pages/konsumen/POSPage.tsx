import { useReducer, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateSaleResponse, PosPaymentMethod, Product } from "@siskop/types";
import { createPOSSale, getProducts } from "@/api/konsumen";
import { ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { ProductSearchGrid } from "@/components/konsumen/ProductSearchGrid";
import { POSCart, type CartLine } from "@/components/konsumen/POSCart";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

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
        paymentMethod
      });
    },
    onSuccess: (sale) => {
      setReceipt(sale);
      dispatch({ type: "CLEAR" });
      setPaymentMethod("CASH");
      void qc.invalidateQueries({ queryKey: ["konsumen", "products", unitId] });
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

  return (
    <div className="space-y-6">
      <PageHeader title="Kasir (POS)" description="Catat transaksi penjualan langsung" />

      {receipt && (
        <Card className="border-green-600/30 bg-green-50 dark:bg-green-950/20">
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              <div>
                <p className="text-sm font-medium text-foreground">Transaksi #{receipt.id} berhasil</p>
                <p className="text-sm text-muted-foreground">Total dibayar: {formatRupiah(receipt.totalAmount)}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setReceipt(null)}>
              Tutup
            </Button>
          </CardContent>
        </Card>
      )}

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof ApiRequestError ? error.message : "Gagal memuat produk"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ProductSearchGrid
              products={products}
              cartQuantity={cartQuantity}
              onAdd={(product) => dispatch({ type: "ADD_ITEM", product })}
            />
          </div>
          <div>
            <POSCart
              lines={cart.lines}
              paymentMethod={paymentMethod}
              onPaymentMethodChange={setPaymentMethod}
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
          </div>
        </div>
      )}
    </div>
  );
}
