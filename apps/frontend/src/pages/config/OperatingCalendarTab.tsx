import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OperatingDaysConfig, TenantHoliday } from "@siskop/types";
import { apiDelete, apiFetch, apiPost, apiPut, ApiRequestError } from "@/api/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";

// Same indexing as the backend (Date#getUTCDay): 0 = Minggu.
const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

/**
 * Hari tutup & hari libur: days with no collection. Loan installments and
 * market charges that would fall on one move to the next operating day.
 */
export function OperatingCalendarTab() {
  const { can } = usePermissions();
  const canEdit = can("config", "update");

  return (
    <div className="space-y-6">
      <ClosedWeekdaysCard canEdit={canEdit} />
      <HolidaysCard canEdit={canEdit} />
    </div>
  );
}

function ClosedWeekdaysCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [closed, setClosed] = useState<number[]>([0]);
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["config", "operating-days"],
    queryFn: () => apiFetch<OperatingDaysConfig>("/config/operating-days")
  });

  useEffect(() => {
    if (data) setClosed(data.closedWeekdays);
  }, [data]);

  function toggle(day: number, isClosed: boolean) {
    setClosed((prev) => (isClosed ? [...prev, day] : prev.filter((d) => d !== day)));
  }

  async function onSave() {
    setApiError("");
    setIsSaving(true);
    try {
      await apiPut("/config/operating-days", { closedWeekdays: closed });
      toast({ title: "Hari tutup disimpan" });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSaving(false);
    }
  }

  if (isPending) return <PageLoading />;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Hari Tutup Mingguan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {apiError && <FormError error={apiError} />}
        <p className="text-sm text-muted-foreground">
          Tidak ada penagihan pada hari yang dicentang. Jatuh tempo yang jatuh pada hari ini digeser ke hari
          operasional berikutnya.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WEEKDAYS.map((label, day) => (
            <div key={day} className="flex items-center gap-2">
              <Checkbox
                id={`closed-${day}`}
                checked={closed.includes(day)}
                disabled={!canEdit}
                onCheckedChange={(checked) => toggle(day, checked === true)}
              />
              <Label htmlFor={`closed-${day}`} className="cursor-pointer font-normal">
                {label}
              </Label>
            </div>
          ))}
        </div>
        {canEdit && (
          <Button onClick={onSave} disabled={isSaving || closed.length >= 7}>
            {isSaving ? "Menyimpan..." : "Simpan"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function HolidaysCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const queryKey = ["config", "holidays", year];
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => apiFetch<TenantHoliday[]>(`/config/holidays?year=${year}`)
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["config", "holidays"] });

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setApiError("");
    setIsSaving(true);
    try {
      await apiPost("/config/holidays", { date, name });
      toast({ title: "Hari libur ditambahkan" });
      setDate("");
      setName("");
      await invalidate();
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete(holiday: TenantHoliday) {
    try {
      await apiDelete(`/config/holidays/${holiday.id}`);
      toast({ title: `${holiday.name} dihapus` });
      await invalidate();
    } catch (err) {
      toast({
        title: "Gagal menghapus",
        description: err instanceof ApiRequestError ? err.message : undefined,
        variant: "destructive"
      });
    }
  }

  const columns: ColumnDef<TenantHoliday>[] = [
    { header: "Tanggal", cell: ({ row }) => formatDate(row.original.date) },
    { accessorKey: "name", header: "Keterangan" },
    ...(canEdit
      ? [
          {
            header: "",
            cell: ({ row }: { row: { original: TenantHoliday } }) => (
              <Button size="sm" variant="ghost" aria-label="Hapus" onClick={() => onDelete(row.original)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )
          }
        ]
      : [])
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hari Libur</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="holiday-date">Tanggal</Label>
              <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label htmlFor="holiday-name">Keterangan</Label>
              <Input
                id="holiday-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mis. Hari Raya Idul Fitri"
                required
              />
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Menyimpan..." : "Tambah"}
            </Button>
          </form>
        )}
        {apiError && <FormError error={apiError} />}

        <DataTable
          columns={columns}
          data={data ?? []}
          isLoading={isPending}
          isError={isError}
          errorMessage={error instanceof Error ? error.message : undefined}
          onRetry={refetch}
          emptyMessage={`Belum ada hari libur di tahun ${year}`}
          headerActions={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setYear((y) => y - 1)}>
                ‹
              </Button>
              <span className="text-sm font-medium tabular-nums">{year}</span>
              <Button size="sm" variant="outline" onClick={() => setYear((y) => y + 1)}>
                ›
              </Button>
            </div>
          }
        />
      </CardContent>
    </Card>
  );
}
