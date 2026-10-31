import { useState } from "react";
import { Copy, Download } from "lucide-react";
import type { MigrationPreview, MigrationResult } from "@siskop/types";
import { apiUpload, ApiRequestError } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/shared/FormError";
import { groupIssues, issueCounts } from "./issues";
import { buildIssueReportCsv, buildIssueSummaryText } from "./report";

const idr = (v: string) => Number(v).toLocaleString("id-ID");

function saveCsv(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  file: File;
  preview: MigrationPreview;
  onBack: () => void;
  onDone: (r: MigrationResult) => void;
}

export function PreviewStep({ file, preview, onBack, onDone }: Props) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { errors, warnings } = issueCounts(preview.issues);
  const baseName = (preview.slug ?? "koperasi") + "-laporan-pratinjau";

  async function execute() {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("fileHash", preview.fileHash);
      form.append("adminPassword", password);
      onDone(await apiUpload<MigrationResult>("/platform/migration/execute", form));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Eksekusi gagal");
    } finally {
      setBusy(false);
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildIssueSummaryText(preview, file.name));
      toast({ title: "Ringkasan disalin" });
    } catch {
      toast({ title: "Gagal menyalin", description: "Izinkan akses papan klip di browser.", variant: "destructive" });
    }
  }

  const totals = preview.totals;
  const cards: [string, string][] = totals
    ? [
        ["Anggota", String(totals.members)],
        ["Rekening simpanan", String(totals.savingAccounts)],
        ["Pinjaman", String(totals.loans)],
        ["Sisa pokok pinjaman", `Rp ${idr(totals.loanRemainingPrincipal)}`],
        ...Object.entries(totals.savingBalanceByType).map(([t, v]): [string, string] => [`Simpanan ${t}`, `Rp ${idr(v)}`]),
        ["Total debit sheet 9", `Rp ${idr(totals.trialDebit)}`],
        ["Total kredit sheet 9", `Rp ${idr(totals.trialCredit)}`]
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          {file.name} · template {preview.mode ?? "tidak dikenali"}
        </p>
        <p className="text-lg font-bold">{preview.tenantName ?? "(nama koperasi belum terbaca)"}</p>
        <p className="text-sm">
          Subdomain: {preview.slug ?? "-"} · Cut-off: {preview.cutoffDate ?? "-"}
        </p>
        <div className="mt-2 flex gap-2">
          <Badge variant={errors ? "bad" : "ok"}>{errors} kesalahan</Badge>
          <Badge variant={warnings ? "warn" : "secondary"}>{warnings} peringatan</Badge>
        </div>
      </div>

      {cards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-card p-3">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="font-bold">{v}</p>
            </div>
          ))}
        </div>
      )}

      {preview.openingEntry.length > 0 && (
        <div className="rounded-lg border bg-card p-5">
          <p className="mb-2 text-sm font-semibold">
            Jurnal "Saldo Awal Migrasi" yang akan dibuat (hanya selisih terhadap jurnal otomatis simpanan dan pinjaman)
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th>Akun</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Kredit</th>
              </tr>
            </thead>
            <tbody>
              {preview.openingEntry.map((l) => (
                <tr key={l.accountCode}>
                  <td>
                    {l.accountCode} {l.accountName}
                  </td>
                  <td className="text-right">{Number(l.debit) ? idr(l.debit) : ""}</td>
                  <td className="text-right">{Number(l.credit) ? idr(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {groupIssues(preview.issues).map((g) => (
        <div key={g.sheet} className="rounded-lg border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">{g.sheet}</p>
          <ul className="space-y-1 text-sm">
            {g.issues.map((x, idx) => (
              <li key={idx} className={x.severity === "error" ? "text-destructive" : "text-warning"}>
                {x.severity === "error" ? "✖ " : "⚠ "}
                {x.row ? `Baris ${x.row}` : "Sheet"}
                {x.column ? ` · ${x.column}` : ""}: {x.message}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {preview.issues.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => saveCsv(buildIssueReportCsv(preview, file.name, new Date()), `${baseName}.csv`)}>
            <Download className="mr-2 h-4 w-4" />
            Unduh laporan untuk koperasi (CSV)
          </Button>
          <Button variant="outline" onClick={() => void copySummary()}>
            <Copy className="mr-2 h-4 w-4" />
            Salin ringkasan
          </Button>
        </div>
      )}

      <div className="space-y-3 rounded-lg border bg-card p-5">
        <Label htmlFor="adminPassword">Kata sandi admin koperasi (min. 8 karakter, serahkan ke admin lewat jalur aman)</Label>
        <Input
          id="adminPassword"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError error={error} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={busy}>
            Unggah ulang
          </Button>
          <Button onClick={() => void execute()} disabled={!preview.canExecute || password.length < 8 || busy}>
            {busy ? "Memigrasi..." : "Eksekusi migrasi"}
          </Button>
        </div>
        {!preview.canExecute && <p className="text-sm text-destructive">Perbaiki semua kesalahan di file lalu unggah ulang.</p>}
      </div>
    </div>
  );
}
