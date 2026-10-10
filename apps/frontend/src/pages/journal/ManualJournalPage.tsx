import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Account, CreateManualJournalRequest, JournalEntryDetail } from "@siskop/types";
import { apiFetch, apiPost, ApiRequestError } from "@/api/client";
import { formatRupiah, formatTanggalIndonesia } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { useAccessibleUnits } from "@/hooks/useAccessibleUnits";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormError } from "@/components/shared/FormError";
import { BalanceChip } from "@/components/reports/BalanceChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { todayLocal } from "@/pages/reports/regulatory/period";
import { summarizeLines, toRequestLines, type DraftLine } from "./journalForm";

const NO_UNIT = "__none__";

let keySeq = 0;
const blankLine = (): DraftLine => ({ key: `line-${++keySeq}`, accountId: "", debit: "", credit: "" });

export function ManualJournalPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const { data: units } = useAccessibleUnits();
  const { data: accounts, isPending } = useQuery({
    queryKey: ["config", "accounts"],
    queryFn: () => apiFetch<Account[]>("/config/accounts")
  });

  const [entryDate, setEntryDate] = useState(todayLocal);
  const [entryType, setEntryType] = useState<"UMUM" | "PENYESUAIAN">("PENYESUAIAN");
  const [unitId, setUnitId] = useState(NO_UNIT);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine(), blankLine()]);
  const [apiError, setApiError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastEntry, setLastEntry] = useState<JournalEntryDetail | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);

  const postable = useMemo(() => (accounts ?? []).filter((a) => a.isActive && !a.isHeader), [accounts]);
  const summary = summarizeLines(lines);
  const ready = summary.canSubmit && description.trim() !== "" && entryDate !== "";

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const reset = () => {
    setDescription("");
    setLines([blankLine(), blankLine()]);
    setApiError("");
  };

  const submit = async () => {
    setSaving(true);
    setApiError("");
    try {
      const payload: CreateManualJournalRequest = {
        entryDate,
        description: description.trim(),
        entryType,
        unitId: unitId === NO_UNIT ? null : unitId,
        lines: toRequestLines(lines)
      };
      const entry = await apiPost<JournalEntryDetail>("/journal", payload);
      setLastEntry(entry);
      reset();
      toast({ title: `Jurnal No. ${entry.entryNo} berhasil dicatat` });
    } catch (err) {
      setApiError(err instanceof ApiRequestError ? err.message : "Terjadi kesalahan");
    } finally {
      setSaving(false);
    }
  };

  const reverse = async () => {
    if (!lastEntry) return;
    try {
      const entry = await apiPost<JournalEntryDetail>(`/journal/${lastEntry.id}/reverse`, {});
      setLastEntry(entry);
      toast({ title: `Jurnal pembalik No. ${entry.entryNo} dicatat` });
    } catch (err) {
      toast({
        title: "Gagal membalik jurnal",
        description: err instanceof ApiRequestError ? err.message : undefined,
        variant: "destructive"
      });
    } finally {
      setReverseOpen(false);
    }
  };

  if (!can("accounting", "create")) {
    return (
      <div className="space-y-6">
        <PageHeader title="Jurnal Manual" description="Jurnal umum dan penyesuaian" />
        <p className="text-sm text-muted-foreground">Anda tidak memiliki izin untuk mencatat jurnal manual.</p>
      </div>
    );
  }
  if (isPending) return <PageLoading />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jurnal Manual"
        description="Catat jurnal umum atau jurnal penyesuaian akhir periode. Jurnal tidak dapat diubah; koreksi dengan jurnal pembalik."
      />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tanggal</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Jenis jurnal</Label>
              <Select value={entryType} onValueChange={(v) => setEntryType(v as "UMUM" | "PENYESUAIAN")}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENYESUAIAN">Penyesuaian</SelectItem>
                  <SelectItem value="UMUM">Umum</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {units && units.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Unit usaha</Label>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_UNIT}>Tidak dialokasikan</SelectItem>
                    {units
                      .filter((u) => u.isActive)
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Keterangan</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="mis. Penyisihan piutang September" />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-64">Akun</TableHead>
                <TableHead className="w-44 text-right">Debit</TableHead>
                <TableHead className="w-44 text-right">Kredit</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.key}>
                  <TableCell>
                    <Select value={l.accountId} onValueChange={(v) => updateLine(l.key, { accountId: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih akun" />
                      </SelectTrigger>
                      <SelectContent>
                        {postable.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {/* Typing on one side clears the other: a line has exactly one side. */}
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={l.debit}
                      onChange={(e) => updateLine(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={l.credit}
                      onChange={(e) => updateLine(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Hapus baris"
                      disabled={lines.length <= 2}
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(summary.totalDebit / 100)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(summary.totalCredit / 100)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>

          {summary.error && <p className="text-xs text-destructive">{summary.error}</p>}
          <FormError error={apiError} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah baris
              </Button>
              <BalanceChip balanced={summary.difference === 0 && summary.totalDebit > 0} difference={summary.difference / 100} />
            </div>
            <Button onClick={submit} disabled={!ready || saving}>
              {saving ? "Menyimpan..." : "Catat Jurnal"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {lastEntry && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-sm">
                Jurnal terakhir No. {lastEntry.entryNo ?? "-"} <Badge variant="secondary">{lastEntry.entryType}</Badge>
                {lastEntry.reversalOfId && <Badge className="ml-2">Pembalik</Badge>}
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTanggalIndonesia(lastEntry.entryDate)} · {lastEntry.description}
              </p>
            </div>
            {!lastEntry.reversalOfId && (
              <Button variant="outline" size="sm" onClick={() => setReverseOpen(true)}>
                <Undo2 className="mr-2 h-4 w-4" />
                Balik jurnal
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Akun</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Kredit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lastEntry.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.accountCode} — {l.accountName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(l.debit) ? formatRupiah(l.debit) : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(l.credit) ? formatRupiah(l.credit) : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={reverseOpen}
        onOpenChange={setReverseOpen}
        title="Balik jurnal ini?"
        description="Sebuah jurnal pembalik (debit dan kredit ditukar) akan dicatat hari ini. Jurnal asal tetap tersimpan dan tidak dapat dibalik dua kali."
        confirmLabel="Balik jurnal"
        onConfirm={reverse}
      />
    </div>
  );
}
