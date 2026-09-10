import { useMemo, useState } from "react";
import type { Product } from "@siskop/types";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search, PackageSearch } from "lucide-react";

/**
 * Tappable product grid for POSPage. `cartQuantity` looks up how many of
 * this product are already in the cart, so a tile can be disabled once the
 * cart would exceed `product.stockLevel` — a client-side UX nicety only;
 * the backend transaction is still the real source of truth and will reject
 * an over-stock sale regardless (see sale.service.ts).
 */
export function ProductSearchGrid({
  products,
  cartQuantity,
  onAdd
}: {
  products: Product[];
  cartQuantity: (productId: string) => number;
  onAdd: (product: Product) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari nama atau SKU produk..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <PackageSearch className="h-10 w-10" />
            <p className="text-sm">Produk tidak ditemukan</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product) => {
            const stockLevel = Number(product.stockLevel);
            const inCart = cartQuantity(product.id);
            const isOutOfStock = stockLevel <= 0;
            const isAtMax = !isOutOfStock && inCart >= stockLevel;
            const disabled = isOutOfStock || isAtMax;

            return (
              <button
                key={product.id}
                type="button"
                disabled={disabled}
                onClick={() => onAdd(product)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors hover:border-primary hover:bg-muted/50",
                  disabled && "cursor-not-allowed opacity-50 hover:border-input hover:bg-transparent"
                )}
              >
                <span className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{product.sku}</span>
                <span className="mt-1 text-sm font-semibold text-primary">{formatRupiah(product.sellPrice)}</span>
                <span className={cn("text-xs text-muted-foreground", (isOutOfStock || isAtMax) && "text-destructive")}>
                  {isOutOfStock
                    ? "Stok habis"
                    : isAtMax
                      ? "Stok maksimum"
                      : `Stok: ${stockLevel} ${product.uom}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
