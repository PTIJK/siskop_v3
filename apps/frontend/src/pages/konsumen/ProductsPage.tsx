import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getProducts } from "@/api/konsumen";
import { ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { ProductRow } from "@/components/konsumen/ProductRow";
import { CreateProductDialog } from "@/components/konsumen/CreateProductDialog";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Plus } from "lucide-react";

// GET /api/konsumen/products?unitId= isn't paginated (product.schema.ts's
// listProductsQuerySchema takes only unitId), so this renders a plain Table
// of ProductRow rather than the generic paginated DataTable used elsewhere
// (e.g. MembersPage).
export function ProductsPage() {
  const { unitId } = useParams<{ unitId: string }>();
  const { can } = usePermissions();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["konsumen", "products", unitId],
    queryFn: () => getProducts(unitId as string),
    enabled: Boolean(unitId)
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produk"
        description="Daftar produk unit usaha ini"
        actions={
          can("konsumen", "create") && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Tambah produk
            </Button>
          )
        }
      />

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof ApiRequestError ? error.message : "Gagal memuat produk"}
          </CardContent>
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Package className="h-10 w-10" />
            <p className="text-sm">Belum ada produk</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nama Produk</TableHead>
                <TableHead>Harga Jual</TableHead>
                <TableHead>Stok</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {unitId && <CreateProductDialog unitId={unitId} open={dialogOpen} onOpenChange={setDialogOpen} />}
    </div>
  );
}
