import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getStockMovements } from "@/api/konsumen";
import { ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { StockMovementForm } from "@/components/konsumen/StockMovementForm";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

const MOVEMENT_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  IN: "default",
  OUT: "secondary",
  ADJUSTMENT: "outline"
};

const MOVEMENT_LABEL: Record<string, string> = {
  IN: "Masuk",
  OUT: "Keluar",
  ADJUSTMENT: "Penyesuaian"
};

const formatWaktu = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

// GET /api/konsumen/stock-movements?unitId= isn't paginated either
// (product.schema.ts's listStockMovementsQuerySchema takes only unitId,
// service.ts orders desc by createdAt) — plain Table, same reasoning as
// ProductsPage.
export function StockPage() {
  const { unitId } = useParams<{ unitId: string }>();
  const { can } = usePermissions();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["konsumen", "stock-movements", unitId],
    queryFn: () => getStockMovements(unitId as string),
    enabled: Boolean(unitId)
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Stok" description="Riwayat pergerakan stok dan pencatatan manual" />

      {unitId && can("konsumen", "update") && <StockMovementForm unitId={unitId} />}

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {error instanceof ApiRequestError ? error.message : "Gagal memuat riwayat stok"}
          </CardContent>
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <ClipboardList className="h-10 w-10" />
            <p className="text-sm">Belum ada pergerakan stok</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Jumlah</TableHead>
                <TableHead>Alasan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatWaktu(m.createdAt)}</TableCell>
                  <TableCell className="font-medium text-foreground">{m.productName}</TableCell>
                  <TableCell>
                    <Badge variant={MOVEMENT_BADGE_VARIANT[m.type] ?? "outline"}>{MOVEMENT_LABEL[m.type] ?? m.type}</Badge>
                  </TableCell>
                  <TableCell>{m.quantity}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
