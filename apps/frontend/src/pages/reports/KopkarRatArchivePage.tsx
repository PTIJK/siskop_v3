import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { KOPKAR_RAT_TENANT_ID, type KopkarRatArchive, type KopkarRatFileKind, type KopkarRatRow, type User } from "@siskop/types";
import { apiDownload, apiFetch } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function canReviewKopkarRat(user: User | null): boolean {
  return user?.tenantId === KOPKAR_RAT_TENANT_ID &&
    user.roleName === "Super Admin" && !user.isPlatformAdmin && user.permissions.reports.read === true;
}

export function KopkarRatArchivePage({ platform = false }: { platform?: boolean }) {
  const user = useAuth((s) => s.user);
  const allowed = platform ? user?.role === "super_admin" : canReviewKopkarRat(user);
  const endpoint = platform ? "/platform/migration/kopkar-rat" : "/reports/arsip-rat";
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [kind, setKind] = useState<KopkarRatFileKind>("prepared_review");
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState(1);
  const archive = useQuery({
    queryKey: [endpoint, user?.id, kind, sheet, page],
    queryFn: () => apiFetch<KopkarRatArchive>(`${endpoint}?${new URLSearchParams({ kind, page: String(page), ...(sheet && { sheet }) })}`),
    enabled: allowed,
    placeholderData: keepPreviousData,
    gcTime: 0,
    retry: false
  });
  if (!allowed) return <Navigate to="/dashboard" replace />;

  const selectedFile = archive.data?.files.find((file) => file.kind === kind);
  async function download() {
    if (!selectedFile || downloading) return;
    setDownloading(true);
    try {
      const blob = await apiDownload(`${endpoint}/file?${new URLSearchParams({ kind })}`);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: selectedFile.name }).click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "File Excel gagal diunduh", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  const data = archive.data?.sheet;
  const settled = !!data && !archive.isPlaceholderData;
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Arsip RAT 2025 · Kopkar UM Surabaya"
        description="Tinjau data asli dari Excel dan catatan pemeriksaan. Nilai arsip tetap sama setelah penerbitan."
        breadcrumb={[platform ? { label: "Migrasi Koperasi", href: "/platform/migration" } : { label: "Laporan", href: "/reports" }, { label: "Arsip RAT 2025" }]}
        actions={!platform && <>
          {user?.permissions.reports.export && (
            <Button variant="outline" className="min-h-11" disabled={!selectedFile || downloading} onClick={() => void download()}>
              {downloading ? "Mengunduh…" : "Unduh file Excel"}
            </Button>
          )}
          {user && (user.permissions.members.create ||
            (user.permissions.accounting?.create && user.permissions.reports.update && (user.permissions.savings.create || user.permissions.loans.create))) && (
            <Button asChild className="min-h-11"><Link to="/reports/arsip-rat/terbitkan">Terbitkan data</Link></Button>
          )}
        </>}
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
