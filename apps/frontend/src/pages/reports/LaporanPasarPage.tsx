import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Market,
  RekapHarianKolektor,
  TunggakanAngsuranRow,
  TunggakanSewaRetribusiRow
} from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { downloadFile } from "@/lib/pdf";
import { formatRupiah, formatTanggalIndonesia } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  TIDAK_ADA_SETORAN: "Tidak Ada Setoran",
  OPEN: "Berjalan",
  SUBMITTED: "Menunggu Verifikasi",
  VERIFIED: "Terverifikasi"
};
const STATUS_VARIANT: Record<string, "outline" | "default" | "secondary"> = {
  TIDAK_ADA_SETORAN: "outline",
  OPEN: "secondary",
  SUBMITTED: "secondary",
  VERIFIED: "default"
};

/** Not entitled (pasar module) surfaces the same way every other pasar-gated page does — see ConsolidatedReportPage.tsx. */
function isNotEntitled(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED";
}

export function LaporanPasarPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("rekap-kolektor");

  const [rekapDate, setRekapDate] = useState(new Date().toISOString().slice(0, 10));
  const rekapQuery = useQuery({
    queryKey: ["reports", "pasar", "rekap-kolektor", rekapDate],
    queryFn: () => apiFetch<RekapHarianKolektor>(`/reports/pasar/rekap-kolektor?date=${rekapDate}`),
    retry: (count, err) => (isNotEntitled(err) ? false : count < 3)
  });

  const marketsQuery = useQuery({
    queryKey: ["market", "markets"],
    queryFn: () => apiFetch<Market[]>("/market/markets"),
    retry: (count, err) => (isNotEntitled(err) ? false : count < 3)
  });

  const [angsuranMarketId, setAngsuranMarketId] = useState<string>("ALL");
  const [angsuranBlock, setAngsuranBlock] = useState("");
  const angsuranQuery = useQuery({
    queryKey: ["reports", "pasar", "tunggakan-angsuran", angsuranMarketId, angsuranBlock],
    queryFn: () => {
      const params = new URLSearchParams();
      if (angsuranMarketId !== "ALL") params.set("marketId", angsuranMarketId);
      if (angsuranBlock) params.set("block", angsuranBlock);
      return apiFetch<TunggakanAngsuranRow[]>(`/reports/pasar/tunggakan-angsuran?${params.toString()}`);
    },
    retry: (count, err) => (isNotEntitled(err) ? false : count < 3),
    enabled: activeTab === "tunggakan-angsuran"
  });

  const [sewaMarketId, setSewaMarketId] = useState<string>("ALL");
  const [sewaBlock, setSewaBlock] = useState("");
  const sewaQuery = useQuery({
    queryKey: ["reports", "pasar", "tunggakan-sewa-retribusi", sewaMarketId, sewaBlock],
    queryFn: () => {
      const params = new URLSearchParams();
      if (sewaMarketId !== "ALL") params.set("marketId", sewaMarketId);
      if (sewaBlock) params.set("block", sewaBlock);
      return apiFetch<TunggakanSewaRetribusiRow[]>(`/reports/pasar/tunggakan-sewa-retribusi?${params.toString()}`);
    },
    retry: (count, err) => (isNotEntitled(err) ? false : count < 3),
    enabled: activeTab === "tunggakan-sewa-retribusi"
  });

  const downloadRekapCsv = async () => {
    try {
      await downloadFile(`/reports/pasar/rekap-kolektor/csv?date=${rekapDate}`, `rekap-kolektor-${rekapDate}.csv`);
    } catch {
      toast({ title: "Gagal mengunduh CSV", variant: "destructive" });
    }
  };

  if (isNotEntitled(rekapQuery.error)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Laporan Pasar" description="Rekap kolektor dan tunggakan sewa/retribusi/angsuran" />
        <EntitlementNotice message={rekapQuery.error.message} />
      </div>
    );
  }

  const rekapColumns: ColumnDef<RekapHarianKolektor["rows"][number]>[] = [
    { header: "Kolektor", accessorKey: "collectorName" },
    { header: "Target", cell: ({ row }) => (row.original.target !== null ? formatRupiah(row.original.target) : "-") },
    { header: "Tertagih", cell: ({ row }) => formatRupiah(row.original.tertagih) },
    { header: "Disetor", cell: ({ row }) => (row.original.disetor !== null ? formatRupiah(row.original.disetor) : "-") },
    {
      header: "Selisih",
      cell: ({ row }) =>
        row.original.selisih !== null ? (
          <span className={Number(row.original.selisih) < 0 ? "text-destructive" : "text-green-700"}>
            {formatRupiah(row.original.selisih)}
          </span>
        ) : (
          "-"
        )
    },
    {
      header: "Status",
      cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge>
    }
  ];

  const angsuranColumns: ColumnDef<TunggakanAngsuranRow>[] = [
    { header: "Anggota", accessorKey: "memberName" },
    { header: "Kolektor", cell: ({ row }) => row.original.collectorName ?? "-" },
    {
      header: "Pasar/Blok/Kios",
      cell: ({ row }) =>
        row.original.marketName
          ? `${row.original.marketName} / ${row.original.block ?? "-"} / ${row.original.stallCode ?? "-"}`
          : "-"
    },
    { header: "Cicilan Ke", accessorKey: "installmentSeq" },
    { header: "Jatuh Tempo", cell: ({ row }) => formatTanggalIndonesia(row.original.dueDate) },
    { header: "Nominal", cell: ({ row }) => formatRupiah(row.original.amountDue) },
    {
      header: "Hari Terlambat",
      cell: ({ row }) => <span className="font-semibold text-destructive">{row.original.daysOverdue} hari</span>
    }
  ];

  const sewaColumns: ColumnDef<TunggakanSewaRetribusiRow>[] = [
    { header: "Anggota", accessorKey: "memberName" },
    { header: "Kios", cell: ({ row }) => `${row.original.marketName} / ${row.original.block ?? "-"} / ${row.original.stallCode}` },
    { header: "Jenis", cell: ({ row }) => (row.original.kind === "SEWA" ? "Sewa" : "Retribusi") },
    { header: "Jatuh Tempo", cell: ({ row }) => formatTanggalIndonesia(row.original.dueDate) },
    { header: "Nominal", cell: ({ row }) => formatRupiah(row.original.amountDue) },
    {
      header: "Hari Terlambat",
      cell: ({ row }) => <span className="font-semibold text-destructive">{row.original.daysOverdue} hari</span>
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Laporan Pasar" description="Rekap kolektor dan tunggakan sewa/retribusi/angsuran" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="rekap-kolektor">Rekap Harian Kolektor</TabsTrigger>
          <TabsTrigger value="tunggakan-angsuran">Tunggakan Angsuran</TabsTrigger>
          <TabsTrigger value="tunggakan-sewa-retribusi">Tunggakan Sewa & Retribusi</TabsTrigger>
        </TabsList>

        <TabsContent value="rekap-kolektor" className="mt-4">
          <DataTable
            columns={rekapColumns}
            data={rekapQuery.data?.rows ?? []}
            isLoading={rekapQuery.isPending}
            isError={rekapQuery.isError}
            errorMessage={rekapQuery.error instanceof Error ? rekapQuery.error.message : undefined}
            onRetry={rekapQuery.refetch}
            emptyMessage="Belum ada kolektor untuk direkap"
            headerActions={
              <div className="flex items-center gap-2">
                <Input type="date" value={rekapDate} onChange={(e) => setRekapDate(e.target.value)} className="w-40" />
                <Button size="sm" variant="outline" onClick={downloadRekapCsv}>
                  <Download className="mr-2 h-3.5 w-3.5" /> Unduh CSV
                </Button>
              </div>
            }
          />
        </TabsContent>

        <TabsContent value="tunggakan-angsuran" className="mt-4">
          <DataTable
            columns={angsuranColumns}
            data={angsuranQuery.data ?? []}
            isLoading={angsuranQuery.isPending}
            isError={angsuranQuery.isError}
            errorMessage={angsuranQuery.error instanceof Error ? angsuranQuery.error.message : undefined}
            onRetry={angsuranQuery.refetch}
            emptyMessage="Tidak ada tunggakan angsuran"
            headerActions={
              <div className="flex items-center gap-2">
                <Select value={angsuranMarketId} onValueChange={setAngsuranMarketId}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Pasar</SelectItem>
                    {(marketsQuery.data ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="w-32">
                  <Label className="sr-only">Blok</Label>
                  <Input placeholder="Blok..." value={angsuranBlock} onChange={(e) => setAngsuranBlock(e.target.value)} />
                </div>
              </div>
            }
          />
        </TabsContent>

        <TabsContent value="tunggakan-sewa-retribusi" className="mt-4">
          <DataTable
            columns={sewaColumns}
            data={sewaQuery.data ?? []}
            isLoading={sewaQuery.isPending}
            isError={sewaQuery.isError}
            errorMessage={sewaQuery.error instanceof Error ? sewaQuery.error.message : undefined}
            onRetry={sewaQuery.refetch}
            emptyMessage="Tidak ada tunggakan sewa/retribusi"
            headerActions={
              <div className="flex items-center gap-2">
                <Select value={sewaMarketId} onValueChange={setSewaMarketId}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Pasar</SelectItem>
                    {(marketsQuery.data ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="w-32">
                  <Label className="sr-only">Blok</Label>
                  <Input placeholder="Blok..." value={sewaBlock} onChange={(e) => setSewaBlock(e.target.value)} />
                </div>
              </div>
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
