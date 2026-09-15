import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import type { MemberRegistrationRequest } from "@siskop/types";
import { apiFetchPage, apiPost, ApiRequestError } from "@/api/client";
import { formatTanggalPendek } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { RejectRequestDialog } from "./RejectRequestDialog";

const LIMIT = 20;

export function RegistrationRequestsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // Anti-rubber-stamp friction, deliberate per product spec: a request whose
  // KTP photo hasn't been opened at least once THIS session can't be
  // approved yet. Session-only (not persisted) and per-request id. A request
  // with no photo at all has nothing to inspect, so it's exempt.
  const [viewedKtp, setViewedKtp] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<MemberRegistrationRequest | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["members", "registration-requests", { page }],
    queryFn: () =>
      apiFetchPage<MemberRegistrationRequest[]>(`/members/registration-requests?status=PENDING&page=${page}&limit=${LIMIT}`)
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["members", "registration-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/members/registration-requests/${id}/approve`, {}),
    onSuccess: (_data, id) => {
      toast({ title: "Pendaftaran disetujui, anggota baru berhasil dibuat" });
      setViewedKtp((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      invalidate();
    },
    onError: (err) => {
      toast({
        title: "Gagal menyetujui pendaftaran",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, rejectionReason }: { id: string; rejectionReason: string }) =>
      apiPost(`/members/registration-requests/${id}/reject`, { rejectionReason }),
    onSuccess: () => {
      toast({ title: "Pendaftaran ditolak" });
      setRejectTarget(null);
      invalidate();
    },
    onError: (err) => {
      toast({
        title: "Gagal menolak pendaftaran",
        description: err instanceof ApiRequestError ? err.message : "Terjadi kesalahan",
        variant: "destructive"
      });
    }
  });

  function openKtp(row: MemberRegistrationRequest) {
    if (!row.ktpPhotoUrl) return;
    window.open(row.ktpPhotoUrl, "_blank", "noopener,noreferrer");
    setViewedKtp((prev) => new Set(prev).add(row.id));
  }

  function canApprove(row: MemberRegistrationRequest) {
    return !row.ktpPhotoUrl || viewedKtp.has(row.id);
  }

  const columns: ColumnDef<MemberRegistrationRequest>[] = [
    { header: "Nama Lengkap", accessorKey: "fullName" },
    { header: "NIK", accessorKey: "nik", className: "font-mono text-xs" },
    { header: "Telepon", cell: ({ row }) => row.original.phone ?? "-" },
    { header: "Tgl. Daftar", cell: ({ row }) => formatTanggalPendek(row.original.submittedAt) },
    {
      header: "Foto KTP",
      cell: ({ row }) =>
        row.original.ktpPhotoUrl ? (
          <Button
            size="sm"
            variant={viewedKtp.has(row.original.id) ? "outline" : "default"}
            onClick={(e) => {
              e.stopPropagation();
              openKtp(row.original);
            }}
          >
            {viewedKtp.has(row.original.id) ? "Lihat Lagi" : "Lihat Foto"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Tidak ada</span>
        )
    },
    {
      header: "Aksi",
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!canApprove(row.original) || approveMutation.isPending}
            title={!canApprove(row.original) ? "Lihat foto KTP terlebih dahulu sebelum menyetujui" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              approveMutation.mutate(row.original.id);
            }}
          >
            Setujui
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setRejectTarget(row.original);
            }}
          >
            Tolak
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pendaftaran yang masuk melalui QR pendaftaran mandiri. Tinjau foto KTP sebelum menyetujui — tombol Setujui
        aktif setelah foto dibuka.
      </p>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        pagination={{ page, limit: LIMIT, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyMessage="Tidak ada pendaftaran mandiri yang menunggu persetujuan"
      />

      {rejectTarget && (
        <RejectRequestDialog
          open={!!rejectTarget}
          onOpenChange={(open) => !open && setRejectTarget(null)}
          fullName={rejectTarget.fullName}
          isSubmitting={rejectMutation.isPending}
          onConfirm={(rejectionReason) => rejectMutation.mutate({ id: rejectTarget.id, rejectionReason })}
        />
      )}
    </div>
  );
}
