import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import type { KopkarRatArchive, KopkarRatFileKind, KopkarRatRow } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/stores/auth";

const flagLabels = {
  missing_nik: "NIK belum tersedia",
  unverified_balance: "Saldo belum diverifikasi"
};

function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}

export function PlatformKopkarRatPage() {
  const role = useAuth((s) => s.user?.role);
  const [kind, setKind] = useState<KopkarRatFileKind>("prepared_review");
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState(1);
  const archive = useQuery({
    queryKey: ["platform", "kopkar-rat", kind, sheet, page],
    queryFn: () => apiFetch<KopkarRatArchive>(`/platform/migration/kopkar-rat?${new URLSearchParams({ kind, page: String(page), ...(sheet && { sheet }) })}`),
    enabled: role === "super_admin",
    placeholderData: keepPreviousData,
    gcTime: 0,
    retry: false
  });
  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  const data = archive.data?.sheet;
  const settled = !!data && !archive.isPlaceholderData;
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Arsip RAT 2025 · Kopkar UM Surabaya"
        description="Tinjau data dari Excel dan catatan pemeriksaan. Arsip ini hanya untuk dibaca dan belum masuk ke data aktif."
        breadcrumb={[{ label: "Migrasi Koperasi", href: "/platform/migration" }, { label: "Arsip RAT 2025" }]}
      />
      {!!archive.data?.files.length && (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="rat-file">File Excel</Label>
            <Select value={kind} onValueChange={(next) => { setKind(next as KopkarRatFileKind); setSheet(""); setPage(1); }}>
              <SelectTrigger id="rat-file" className="min-h-11 [&>span]:truncate"><SelectValue /></SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                {archive.data.files.map((file) => <SelectItem key={file.kind} value={file.kind}>{file.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="rat-sheet">Sheet</Label>
            <Select value={sheet || (data?.kind === kind ? data.name : "")} disabled={data?.kind !== kind} onValueChange={(next) => { setSheet(next); setPage(1); }}>
              <SelectTrigger id="rat-sheet" className="min-h-11"><SelectValue placeholder="Pilih sheet" /></SelectTrigger>
              <SelectContent>
                {data?.kind === kind && data.names.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <DataTable<KopkarRatRow>
        key={`${kind}:${sheet}`}
        label={`Baris Excel ${settled ? data.name : "arsip RAT"}`}
        data={settled ? data.rows : []}
        isLoading={archive.isPending || archive.isPlaceholderData}
        isError={archive.isError}
        onRetry={() => void archive.refetch()}
        emptyMessage={data ? "Sheet ini tidak berisi data" : "Belum ada arsip RAT"}
        getRowKey={(row) => String(row.row)}
        pagination={settled ? { page: data.page, limit: data.limit, total: data.total, onPageChange: setPage } : undefined}
        columns={[
          { header: "Baris Excel", accessorKey: "row" },
          { header: "Isi sumber", className: "[overflow-wrap:anywhere]", cell: ({ row: { original } }) =>
            original.cells.filter((cell) => cell !== null && cell !== "").slice(0, 4).join(" · ") || "Kosong" },
          { header: "Catatan pemeriksaan", className: "max-[900px]:col-span-2", cell: ({ row: { original } }) =>
            original.flags.length || original.notes.length ? (
              <div className="space-y-1.5 text-sm [overflow-wrap:anywhere]">
                <div className="flex flex-wrap gap-1">
                  {original.flags.map((flag) => <Badge key={flag} variant="warn">{flagLabels[flag]}</Badge>)}
                </div>
                {original.notes.map((note, index) => <p key={index}>{note}</p>)}
              </div>
            ) : <span className="text-muted-foreground">—</span> }
        ]}
        renderExpanded={(row) => (
          <dl className="grid gap-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
            {row.cells.map((value, index) => (
              <div key={index} className="min-w-0">
                <dt className="text-xs font-semibold text-muted-foreground">{columnLabel(index)}{row.row}</dt>
                <dd className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{value ?? "Kosong"}</dd>
              </div>
            ))}
          </dl>
        )}
      />
      <p className="text-sm text-muted-foreground">Buka baris untuk melihat semua sel dan lokasi aslinya di Excel.</p>
    </div>
  );
}
