import type { Product } from "@siskop/types";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

// Products aren't paginated/searched server-side (product.schema.ts's
// listProductsQuerySchema takes only unitId), so ProductsPage renders a
// plain Table of these rather than the generic DataTable used by paginated
// list pages elsewhere.
export const LOW_STOCK_THRESHOLD = 10;

export function ProductRow({ product }: { product: Product }) {
  // Product.stockLevel is a plain int exposed as a string over the wire
  // (see packages/types/src/konsumen.ts) — not Decimal money, so Number()
  // rather than formatRupiah is correct here.
  const stockLevel = Number(product.stockLevel);
  const isLowStock = stockLevel < LOW_STOCK_THRESHOLD;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{product.sku}</TableCell>
      <TableCell>
        <p className="font-medium text-foreground">{product.name}</p>
        {product.category && <p className="text-xs text-muted-foreground">{product.category}</p>}
      </TableCell>
      <TableCell>{formatRupiah(product.sellPrice)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className={cn("font-medium", isLowStock && "text-destructive")}>
            {stockLevel} {product.uom}
          </span>
          {isLowStock && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Stok menipis
            </Badge>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
