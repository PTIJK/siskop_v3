import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import type { RatPublishKind, RatPublishOptions, RatPublishPreview, RatPublishReceipt, RatPublishSource } from "@siskop/types";
import { apiFetch, apiPost } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { PageHeader } from "@/components/shared/PageHeader";
import { formatRupiahRinci } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import { loanFields } from "@/pages/rat/FinancialDraftRows";
import { canReviewKopkarRat } from "./KopkarRatArchivePage";

const BASE = "/reports/arsip-rat/publish";
const LIMIT = 25;
const labels = { member: "Anggota", saving: "Simpanan", loan: "Pinjaman" };
const resource = { member: "members", saving: "savings", loan: "loans" } as const;
const memberFields = [
  ["fullName", "Nama sesuai identitas"], ["nik", "NIK terverifikasi"], ["address", "Alamat"],
  ["birthPlace", "Tempat lahir"], ["birthDate", "Tanggal lahir", "date"], ["occupation", "Pekerjaan"]
] as const;
type Fields = Record<string, string>;
type Draft = { source: RatPublishSource; fields: Fields; selected: boolean };
type Opening = { unitId: string; cutoffDate: string; offsetAccountId: string; verificationRef: string };

function TextField({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (value: string) => void; type?: string;
}) {
  return <Label className="flex min-w-0 flex-col gap-1.5">{label}
    <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
  </Label>;
}

function Choice({ label, choices, value, onChange }: {
  label: string; choices: { id: string; name: string }[]; value: string; onChange: (value: string) => void;
}) {
  return <Label className="flex min-w-0 flex-col gap-1.5">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)}
      className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <option value="">Pilih…</option>
      {choices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  </Label>;
}

function makeBatch(kind: RatPublishKind, drafts: Draft[], opening: Opening): unknown {
  const rows = drafts.filter((d) => d.selected).map(({ source, fields }) => {
    const sourceRow = source.sourceRow;
    if (kind === "member") {
      return fields.action === "link"
        ? { sourceRow, action: "link", memberId: fields.memberId?.trim(), verifiedNik: fields.verifiedNik?.trim() }
        : { sourceRow, action: "create", identity: Object.fromEntries(memberFields.map(([key]) => [key, fields[key]?.trim() ?? ""])) };
    }
    if (kind === "saving") return { sourceRow, productId: fields.productId, balance: fields.balance?.trim() ?? "" };
    const schedule = (fields.schedule ?? "").split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      const parts = line.split(";").map((part) => part.trim());
      if (parts.length !== 3) throw new Error("Baris Excel " + sourceRow + ", jadwal " + (index + 1) + ": isi tanggal; pokok; margin.");
      return { dueDate: parts[0], principal: parts[1], margin: parts[2] };
    });
    return { sourceRow, productId: fields.productId, schedule, ...Object.fromEntries(loanFields.map(([key]) => [key, fields[key]?.trim() ?? ""])) };
  });
  return kind === "member" ? { kind, unitId: opening.unitId, rows } : { kind, ...opening, rows };
}

export function KopkarRatPublishPage() {
  const user = useAuth((state) => state.user);
  const [kind, setKind] = useState<RatPublishKind>("member");
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState<Opening>({ unitId: "", cutoffDate: "", offsetAccountId: "", verificationRef: "" });
  const [preview, setPreview] = useState<{ result: RatPublishPreview; batch: unknown } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<RatPublishReceipt | null>(null);
  const choices = (["member", "saving", "loan"] as const).filter((type) => user?.permissions[resource[type]].create &&
    (type === "member" || (user.permissions.accounting?.create && user.permissions.reports.update)));
  const allowed = canReviewKopkarRat(user) && choices.length > 0;
  const queryKey = [BASE, user?.id, kind];
  const options = useQuery({
    queryKey, enabled: allowed && choices.includes(kind), gcTime: 0, retry: false,
    queryFn: () => apiFetch<RatPublishOptions>(BASE + "?" + new URLSearchParams({ kind }))
  });
  if (!allowed) return <Navigate to="/reports/arsip-rat" replace />;

  function clearPreview() { setPreview(null); setConfirmed(false); setError(""); setReceipt(null); }
  const selected = drafts.filter((d) => d.selected).length;
  const rows = (options.data?.rows ?? []).filter((r) =>
    (r.name + " " + r.reference + " " + r.sourceRow).toLowerCase().includes(search.trim().toLowerCase()));
  function changeOpening(key: keyof Opening, value: string) { clearPreview(); setOpening((old) => ({ ...old, [key]: value })); }
  function changeDraft(sourceRow: number, change: (draft: Draft) => Draft) {
    clearPreview(); setDrafts((old) => old.map((draft) => draft.source.sourceRow === sourceRow ? change(draft) : draft));
  }
  function edit(source: RatPublishSource) {
    if (drafts.some((d) => d.source.sourceRow === source.sourceRow)) return;
    if (drafts.length >= (kind === "loan" ? 10 : 25)) { setError("Batch sudah penuh. Selesaikan atau keluarkan baris terlebih dahulu."); return; }
    clearPreview();
    setDrafts((old) => [...old, { source, selected: false, fields: {
      fullName: source.name, action: "create", balance: source.value ?? "", remainingPrincipal: source.value ?? "",
      ...Object.fromEntries(Object.entries(source.correction ?? {}).map(([field, value]) => [field, value ?? ""])),
      ...source.financialCorrection
    } }]);
  }
  async function check(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    clearPreview();
    try {
      const batch = makeBatch(kind, drafts, opening);
      const result = await apiPost<RatPublishPreview>(BASE + "/preview", batch);
      setPreview({ result, batch });
    } catch (e) { setError(e instanceof Error ? e.message : "Batch gagal diperiksa."); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!preview || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiPost<RatPublishReceipt>(BASE, { batch: preview.batch, token: preview.result.token, confirmed: true });
      const posted = new Set(result.rows.map((r) => r.sourceRow));
      setDrafts((old) => old.filter((d) => !posted.has(d.source.sourceRow)));
      setPreview(null);
      setConfirmed(false);
      setReceipt(result);
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: [kind === "member" ? "members" : kind === "saving" ? "savings" : "loans"] })
      ]);
    } catch (e) { setError(e instanceof Error ? e.message : "Batch gagal diterbitkan."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Terbitkan data RAT" description="Perbaiki baris dari arsip, pilih batch, lalu periksa hasil sebelum menerbitkan ke data aktif."
        breadcrumb={[{ label: "Arsip RAT 2025", href: "/reports/arsip-rat" }, { label: "Terbitkan data" }]} />
      <fieldset disabled={busy} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice label="Jenis data" choices={choices.map((id) => ({ id, name: labels[id] }))} value={choices.includes(kind) ? kind : ""}
            onChange={(id) => { if (!id) return; setKind(id as RatPublishKind); setDrafts([]); setPage(1); setSearch(""); clearPreview(); }} />
          <Choice label="Unit simpan pinjam" choices={options.data?.units ?? []} value={opening.unitId} onChange={(id) => changeOpening("unitId", id)} />
        </div>
        {kind !== "member" && (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">Konfirmasi petugas pembukuan</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Tanggal saldo awal" type="date" value={opening.cutoffDate} onChange={(v) => changeOpening("cutoffDate", v)} />
              <Choice label="Akun penampung" choices={options.data?.offsets ?? []} value={opening.offsetAccountId} onChange={(v) => changeOpening("offsetAccountId", v)} />
              <TextField label="Referensi rekonsiliasi" value={opening.verificationRef} onChange={(v) => changeOpening("verificationRef", v)} />
            </div>
            {options.data?.products.length === 0 && <p className="text-sm text-warning">Siapkan produk aktif beserta pemetaan jurnalnya di Pengaturan.</p>}
          </div>
        )}
        {choices.includes(kind) && <DataTable<RatPublishSource>
          label="Baris arsip untuk diterbitkan" data={rows.slice((page - 1) * LIMIT, page * LIMIT)}
          isLoading={options.isPending} isError={options.isError} onRetry={() => void options.refetch()}
          getRowKey={(row) => String(row.sourceRow)}
          pagination={{ page, limit: LIMIT, total: rows.length, onPageChange: setPage }}
          search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: "Cari nama, referensi, atau baris" }}
          columns={[
            { header: "Baris", accessorKey: "sourceRow" },
            { header: "Nama dan referensi", cell: ({ row: { original: r } }) => <span className="break-words">{r.name}<br /><small>{r.reference}</small></span> },
            { header: "Nilai sumber", cell: ({ row: { original: r } }) => r.value ?? "—" },
            { header: "Status", cell: ({ row: { original: r } }) => r.published ? <Badge variant="ok">Terbit</Badge> :
              <Button type="button" size="sm" variant="outline" disabled={drafts.some((d) => d.source.sourceRow === r.sourceRow)}
                onClick={() => edit(r)}>Perbaiki</Button> }
          ]}
        />}
        {drafts.length > 0 && (
          <form className="space-y-3" onSubmit={(event) => void check(event)}>
            <h2 className="text-lg font-semibold">Koreksi batch · {selected} dipilih</h2>
            {drafts.map((draft) => {
              const { source, fields } = draft;
              const update = (key: string, value: string) => changeDraft(source.sourceRow, (d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
              return <section key={source.sourceRow} className="space-y-3 rounded-lg border bg-card p-4" aria-label={"Koreksi baris " + source.sourceRow}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-semibold">Baris {source.sourceRow} · {source.name}</h3>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { clearPreview(); setDrafts((old) => old.filter((d) => d.source.sourceRow !== source.sourceRow)); }}>Keluarkan</Button>
                </div>
                {source.notes.map((note, i) => <p key={i} className="text-sm text-warning">{note}</p>)}
                {fields.reviewNote && <p className="text-sm text-muted-foreground">{fields.reviewNote}</p>}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {kind === "member" ? <>
                    <Choice label="Tindakan anggota" value={fields.action ?? "create"} onChange={(v) => update("action", v)}
                      choices={[{ id: "create", name: "Buat anggota aktif" }, { id: "link", name: "Tautkan anggota yang sudah ada" }]} />
                    {fields.action === "link" ? <>
                      <TextField label="ID anggota di SISKOP" value={fields.memberId ?? ""} onChange={(v) => update("memberId", v)} />
                      <TextField label="NIK terverifikasi" value={fields.verifiedNik ?? ""} onChange={(v) => update("verifiedNik", v)} />
                    </> : memberFields.map(([key, label, type]) => <TextField key={key} label={label} type={type} value={fields[key] ?? ""} onChange={(v) => update(key, v)} />)}
                  </> : <>
                    <Choice label="Produk aktif" choices={options.data?.products ?? []} value={fields.productId ?? ""} onChange={(v) => update("productId", v)} />
                    {kind === "saving" ? <TextField label="Saldo terverifikasi (Rp)" value={fields.balance ?? ""} onChange={(v) => update("balance", v)} /> :
                      loanFields.map(([key, label, type]) => <TextField key={key} label={label} type={type} value={fields[key] ?? ""} onChange={(v) => update(key, v)} />)}
                  </>}
                </div>
                {kind === "loan" && <Label className="flex flex-col gap-1.5">Jadwal sisa cicilan, satu baris per jatuh tempo
                  <Textarea value={fields.schedule ?? ""} onChange={(e) => update("schedule", e.target.value)} placeholder="2026-01-10; 1000000; 25000" />
                  <span className="text-xs text-muted-foreground">Format: YYYY-MM-DD; sisa pokok; sisa margin. Gunakan titik untuk desimal dan urutkan berdasarkan tanggal.</span>
                </Label>}
                <Label className="inline-flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={draft.selected} onChange={(e) => changeDraft(source.sourceRow, (d) => ({ ...d, selected: e.target.checked }))} />
                  Data sudah diperiksa, masukkan ke batch
                </Label>
              </section>;
            })}
            <Button type="submit" variant="outline" disabled={!selected || !opening.unitId || busy}>Pratinjau batch</Button>
          </form>
        )}
        {preview && (
          <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Pratinjau sebelum diterbitkan">
            <h2 className="text-lg font-semibold">Pratinjau penerbitan</h2>
            <p className="text-sm text-muted-foreground">{preview.result.unit}{preview.result.cutoffDate && " · " + preview.result.cutoffDate}</p>
            <ul className="divide-y">
              {preview.result.rows.map((r) => <li key={r.sourceRow} className="py-2 text-sm">
                <p className="font-medium">Baris {r.sourceRow} · {r.name} · {r.action}</p>
                {r.journal && <p>Debit {r.journal.debit}; Kredit {r.journal.credit} · {formatRupiahRinci(r.journal.amount)}</p>}
              </li>)}
            </ul>
            <Label className="inline-flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              {kind === "member" ? "Saya mengonfirmasi identitas dan tautan anggota di atas." : "Saya mengonfirmasi pembukuan: tanggal, akun penampung, dan nilai di atas sudah disetujui dan belum tercatat."}
            </Label>
            <div><Button type="button" disabled={!confirmed || busy} onClick={() => void publish()}>Terbitkan {preview.result.rows.length} baris ke data aktif</Button></div>
          </section>
        )}
      </fieldset>
      {error && <div role="alert"><FormError error={error} /></div>}
      {receipt && <p role="status" className="text-sm font-medium">{receipt.rows.length} baris {receipt.alreadyPublished ? "sudah pernah diterbitkan" : "berhasil diterbitkan"}.
        {receipt.rows.some((r) => r.journalEntryNo !== null) && " Jurnal: " + receipt.rows.flatMap((r) => r.journalEntryNo ?? []).join(", ")}</p>}
    </div>
  );
}
