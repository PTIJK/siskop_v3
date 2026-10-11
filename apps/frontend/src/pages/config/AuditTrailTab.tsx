import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuditLog } from "@siskop/types";
import { apiFetchPage } from "@/api/client";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";

const LIMIT = 20;

/** Local to this tab: nowhere else in the app shows a timestamp down to the minute yet. */
function formatWaktu(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function AuditTrailTab() {
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["audit-log", { page }],
    queryFn: () => apiFetchPage<AuditLog[]>(`/audit-log?page=${page}&limit=${LIMIT}`)
  });

  const columns: ColumnDef<AuditLog>[] = [
    { header: "Waktu", cell: ({ row }) => formatWaktu(row.original.createdAt) },
    { header: "Pengguna", cell: ({ row }) => row.original.actorName ?? "Sistem" },
    { header: "Aktivitas", accessorKey: "action", className: "font-mono text-xs" },
    {
      header: "Objek",
      cell: ({ row }) =>
        row.original.entityType
          ? `${row.original.entityType}${row.original.entityId ? ` · ${row.original.entityId}` : ""}`
          : "-"
    }
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      isLoading={isPending}
      isError={isError}
      errorMessage={error instanceof Error ? error.message : undefined}
      onRetry={refetch}
      pagination={{ page, limit: LIMIT, total: data?.meta.total ?? 0, onPageChange: setPage }}
      emptyMessage="Belum ada aktivitas tercatat"
    />
  );
}
