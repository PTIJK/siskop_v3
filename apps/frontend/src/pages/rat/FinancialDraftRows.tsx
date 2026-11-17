import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RatFinancialDirectory, RatFinancialDraft, RatFinancialKind } from "@siskop/types";
import { apiFetch, apiPut } from "@/api/client";
import { FormError } from "@/components/shared/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiahRinci } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import { canReviewKopkarRat } from "@/pages/reports/KopkarRatArchivePage";

const endpoint = "/reports/arsip-rat/financial-drafts/";
const modules = { saving: "savings", loan: "loans" } as const;
const labels = { saving: "simpanan", loan: "pinjaman" };
const savingFields = [["balance", "Saldo (Rp)", undefined]] as const;
export const loanFields = [
  ["contractRef", "Nomor kontrak asli"], ["disbursedAt", "Tanggal cair asli", "date"],
  ["principalAmount", "Pokok kontrak (Rp)"], ["totalAmount", "Total kontrak (Rp)"],
  ["remainingPrincipal", "Sisa pokok (Rp)"], ["remainingAmount", "Sisa kewajiban (Rp)"],
  ["termMonths", "Tenor awal (bulan)"], ["rate", "Tarif kontrak (%)"], ["installmentAmount", "Angsuran kontrak (Rp)"]
] as const;

export type FinancialListRow<T> = { live: T; draft?: never } | { draft: RatFinancialDraft; live?: never };

export function draftValue(row: RatFinancialDraft, field: string) {
  return row.fields[field] ?? row.sourceFields[field] ?? "";
}

export function draftAmount(row: RatFinancialDraft, field: string) {
  const value = draftValue(row, field);
  return /^-?\d+(\.\d{1,2})?$/.test(value) ? formatRupiahRinci(value) : value;
}

export function useFinancialDraftRows(kind: RatFinancialKind, visible: boolean, search: string) {
  const user = useAuth((state) => state.user);
  const module = modules[kind];
  const enabled = visible && canReviewKopkarRat(user) && user?.permissions[module].read === true;
  const editable = enabled && user?.permissions[module].update === true;
  const key = [module, user?.id, "rat-financial-drafts"];
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key, enabled, gcTime: 0, retry: false,
    queryFn: () => apiFetch<RatFinancialDirectory>(endpoint + kind)
  });
  const [open, setOpen] = useState<RatFinancialDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const term = search.trim().toLowerCase();
  const products = query.data?.products ?? [];
  const rows = enabled ? (query.data?.rows ?? []).filter((row) => !term ||
    [row.name, row.ownerRef, row.reference, row.productRef, row.fields.contractRef].some((v) => v?.toLowerCase().includes(term))) : [];

  return {
    enabled, rows, open: (row: RatFinancialDraft) => { setSaved(false); setOpen(row); }, loading: enabled && query.isPending, error: enabled ? query.error : null,
    refetch: () => { if (enabled) void query.refetch(); },
    productName: (row: RatFinancialDraft) => products.find((product) => product.id === row.fields.productId)?.name || row.productRef,
    status: <Badge variant="warn">Belum terverifikasi</Badge>,
    action: (row: RatFinancialDraft) => <Button type="button" size="sm" variant="outline" aria-label={(editable ? "Edit" : "Detail") + " baris Excel " + row.sourceRow}
      onClick={(event) => { event.stopPropagation(); setSaved(false); setOpen(row); }}>{editable ? "Edit" : "Detail"}</Button>,
    editor: <>
      {saved && <p role="status" className="text-sm font-medium">Koreksi tersimpan.</p>}
      {open && <FinancialDraftDialog kind={kind} row={open} products={products} editable={editable}
        onClose={() => { setOpen(null); if (enabled) void query.refetch(); }}
        onSaved={(correction) => {
          client.setQueryData<RatFinancialDirectory>(key, (old) => old && { ...old,
            rows: old.rows.map((row) => row.sourceRow === open.sourceRow ? { ...row, ...correction } : row) });
          setSaved(true);
          setOpen(null);
          void client.invalidateQueries({ queryKey: key });
          void client.invalidateQueries({ queryKey: ["/reports/arsip-rat/publish"] });
        }} />}
    </>
  };
}

type Correction = Pick<RatFinancialDraft, "fields" | "revision">;

function FinancialDraftDialog({ kind, row, products, editable, onClose, onSaved }: {
  kind: RatFinancialKind; row: RatFinancialDraft; products: RatFinancialDirectory["products"]; editable: boolean;
  onClose: () => void; onSaved: (correction: Correction) => void;
}) {
  const [fields, setFields] = useState(row.fields);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const change = (key: string, value: string) => setFields((previous) => ({ ...previous, [key]: value }));
  const fallback = (key: string) => ["termMonths", "installmentAmount"].includes(key) ? "" : row.sourceFields[key] ?? "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editable || saving) return;
    setSaving(true);
    setError("");
    try {
      const corrected = await apiPut<Correction>(endpoint + kind + "/" + row.sourceRow, { revision: row.revision, fields });
      onSaved(corrected);
    } catch (err) { setError(err instanceof Error ? err.message : "Koreksi gagal disimpan."); }
    finally { setSaving(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editable ? "Edit " : "Detail "}{labels[kind]} belum terverifikasi</DialogTitle>
        <DialogDescription>{row.name} · {row.ownerRef} · Baris {row.sourceRow} di Excel RAT 2025</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Referensi Excel {row.reference}{row.productRef && " · " + row.productRef}</p>
          {kind === "loan" && row.sourceFields.termMonths && <p>Sisa tenor pada Excel {row.sourceFields.termMonths} bulan
            {row.sourceFields.installmentAmount && " · Angsuran " + formatRupiahRinci(row.sourceFields.installmentAmount)}
            {row.sourceFields.kolCategory && " · KOL " + row.sourceFields.kolCategory}</p>}
          {row.notes.map((note, index) => <p key={index} className="text-warning">{note}</p>)}
          {editable && <p>Koreksi disimpan untuk ditinjau sebelum saldo dibukukan.</p>}
        </div>
        <fieldset disabled={!editable || saving} className="grid gap-3 sm:grid-cols-2">
          <Label className="flex min-w-0 flex-col gap-1.5">Produk aktif
            <select value={fields.productId ?? ""} onChange={(event) => change("productId", event.target.value)}
              className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">Pilih produk</option>
              {fields.productId && !products.some((product) => product.id === fields.productId) &&
                <option value={fields.productId} disabled>Produk tidak aktif</option>}
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </Label>
          {(kind === "saving" ? savingFields : loanFields).map(([key, label, type]) =>
            <Label key={key} className="flex min-w-0 flex-col gap-1.5">{label}
              <Input type={type ?? "text"} value={fields[key] ?? fallback(key)} onChange={(event) => change(key, event.target.value)} />
            </Label>)}
          {kind === "loan" && <Label className="flex flex-col gap-1.5 sm:col-span-2">Jadwal sisa cicilan
            <Textarea value={fields.schedule ?? ""} maxLength={20000} onChange={(event) => change("schedule", event.target.value)} />
            <span className="text-xs text-muted-foreground">Satu baris per jatuh tempo. Format YYYY-MM-DD; sisa pokok; sisa margin.</span>
          </Label>}
          <Label className="flex flex-col gap-1.5 sm:col-span-2">Catatan koreksi
            <Textarea value={fields.reviewNote ?? ""} maxLength={1000} onChange={(event) => change("reviewNote", event.target.value)} />
          </Label>
        </fieldset>
        {error && <div role="alert"><FormError error={error} /></div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>{editable ? "Batal" : "Tutup"}</Button>
          {editable && <Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan koreksi"}</Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
