import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RepostUnpostedResult, UnpostedJournalSummary } from "@siskop/types";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

const QUERY_KEY = ["config", "journal-unposted"];

// Transactions made before their account mapping existed are stored as
// "belum terposting" and stay out of Neraca/Laba Rugi until reposted — adding
// the mapping later only affects NEW transactions. Reposting rewrites what
// past periods' reports show, so it is an explicit, confirmed action here
// (never a silent side effect of saving a mapping).
//
// Renders nothing while there is nothing repostable, and nothing on error: the
// tabs that host it already surface FEATURE_NOT_ENTITLED / load errors
// themselves, and a missing banner must never block the tab underneath it.
export function UnpostedJournalBanner() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<UnpostedJournalSummary>("/config/journal/unposted"),
    retry: false
  });

  if (!data || data.repostableCount === 0) return null;

  const otherCount = data.items.filter((i) => !i.repostable).reduce((sum, i) => sum + i.count, 0);

  const repost = async () => {
    try {
      const result = await apiPost<RepostUnpostedResult>("/config/journal/repost", {});
      toast({
        title: `${result.reposted} transaksi berhasil diposting`,
        description:
          result.stillUnmapped > 0
            ? `${result.stillUnmapped} transaksi belum bisa diposting karena pemetaan akunnya belum lengkap`
            : undefined
      });
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      toast({
        title: "Gagal memposting transaksi",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  };

  return (
    <>
      <Card className="border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium text-foreground">
                {data.repostableCount} transaksi toko belum terposting ke jurnal
              </p>
              <p className="text-muted-foreground">
                Transaksi ini terjadi sebelum pemetaan akun lengkap, jadi belum masuk Neraca dan Laba Rugi. Lengkapi
                pemetaan akun, lalu posting.
              </p>
              {otherCount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Ada juga {otherCount} transaksi simpanan/pinjaman yang belum terposting; yang ini belum bisa diposting
                  ulang otomatis.
                </p>
              )}
            </div>
          </div>
          {can("accounting", "create") && (
            <Button variant="outline" onClick={() => setConfirmOpen(true)}>
              Posting sekarang
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Posting transaksi yang tertunda?"
        description="Transaksi akan dicatat ke jurnal dengan tanggal aslinya, sehingga laporan periode yang sudah lewat ikut berubah. Hanya transaksi yang pemetaan akunnya sudah lengkap yang diposting; sisanya dibiarkan."
        confirmLabel="Posting sekarang"
        onConfirm={repost}
      />
    </>
  );
}
