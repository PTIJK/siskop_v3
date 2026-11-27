import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type {
  ExcelApplyGroup, ExcelApplyItem, ExcelCorrectionDetail, ExcelCorrectionIdentity, ExcelCorrectionInput, ExcelCorrectionLoan
} from "@siskop/types";
import { apiFetch, apiPost } from "@/api/client";
import { MemberPicker, type PickerMember } from "@/components/shared/MemberPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRupiahRinci } from "@/lib/format";
import { ExcelDateInput, ExcelSelect } from "./ExcelImportFields";

const sections = { anggota: "Anggota", simpanan: "Simpanan", pinjaman: "Pinjaman" } as const;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Koreksi belum dapat disimpan.";
const identityFields = [
  ["fullName", "Nama lengkap"], ["nik", "NIK"], ["address", "Alamat"], ["birthPlace", "Tempat lahir"],
  ["birthDate", "Tanggal lahir"], ["occupation", "Pekerjaan"]
] as const;
const loanFields = [
  ["contractRef", "Nomor kontrak"], ["disbursedAt", "Tanggal pencairan"], ["principalAmount", "Pokok awal"],
  ["totalAmount", "Total kewajiban awal"], ["remainingPrincipal", "Sisa pokok"], ["remainingAmount", "Sisa kewajiban"],
  ["installmentAmount", "Angsuran per periode"], ["termMonths", "Tenor (bulan)"], ["rate", "Tarif kontrak (%)"]
] as const;

export function ExcelCorrectionDialog({ base, unitId, cutoffDate, item, onClose, onSaved, restoreFocus }: {
  base: string;
  unitId: string;
  cutoffDate?: string;
  item: ExcelApplyItem & { fix: NonNullable<ExcelApplyItem["fix"]> };
  onClose: () => void;
  onSaved: () => void;
  restoreFocus: () => void;
}) {
  const { fix } = item;
  const loanOnly = fix.kind === "loan";
  const [group, setGroup] = useState<ExcelApplyGroup>(fix.group);
  const [selectedRow, setSelectedRow] = useState<number>();
  const [selectedSlot, setSelectedSlot] = useState<string | undefined>(fix.slot);
  const path = (ref: Pick<typeof fix, "group" | "index">) => base + "/corrections/" + ref.group + "/" + ref.index;
  const initial = useQuery({
    queryKey: ["excel-correction", path(fix), unitId, fix.basis],
    queryFn: () => apiFetch<ExcelCorrectionDetail>(path(fix) + "?" + new URLSearchParams({ unitId, basis: fix.basis })),
    gcTime: 0, retry: false
  });
  const choices = initial.data?.related[group] ?? [];
  const ref = choices.find((entry) => entry.index === selectedRow) ??
    choices.find((entry) => entry.group === fix.group && entry.index === fix.index) ?? choices[0] ??
    (group === "anggota" ? fix : undefined);
  const needsDetail = !!ref && (ref.group !== fix.group || ref.index !== fix.index);
  const other = useQuery({
    queryKey: ["excel-correction", ref ? path(ref) : "", unitId, ref?.basis],
    queryFn: () => apiFetch<ExcelCorrectionDetail>(path(ref!) + "?" + new URLSearchParams({ unitId, basis: ref!.basis })),
    enabled: initial.isSuccess && needsDetail, gcTime: 0, retry: false
  });
  const detail = needsDetail ? other : initial;
  const kind = group === "anggota" ? "member" : group === "simpanan" ? "saving" : "loan";
  const savingEntry = detail.data?.savingEntries?.find((entry) => entry.slot === selectedSlot) ?? detail.data?.savingEntries?.[0];
  const save = useMutation({
    mutationFn: (correction: ExcelCorrectionInput) => apiPost(path(ref!), {
      unitId, basis: ref?.basis, revision: detail.data?.revision, cutoffDate, correction,
      ...(correction.kind === "saving" ? { slot: savingEntry?.slot } : {})
    }),
    onSuccess: onSaved
  });
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="max-w-[680px]" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <DialogHeader className="pr-7">
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>{item.description}</DialogDescription>
          {initial.data?.source.memberNumber && <p className="text-sm text-muted-foreground">No. anggota Excel {initial.data.source.memberNumber}</p>}
        </DialogHeader>
        {initial.isPending && <p role="status" className="text-sm text-muted-foreground">Memuat data anggota…</p>}
        {initial.isError && <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">{errorText(initial.error)}</p>
          <Button type="button" variant="outline" onClick={() => void initial.refetch()}>Coba lagi</Button>
        </div>}
        {initial.data && <Tabs value={group} onValueChange={(value) => { save.reset(); setSelectedRow(undefined); setGroup(value as ExcelApplyGroup); }}>
          {!loanOnly && (
            <TabsList aria-label="Data anggota yang dipilih" className="grid w-full grid-cols-3">
              {(Object.keys(sections) as ExcelApplyGroup[]).map((section) => (
                <TabsTrigger key={section} value={section} disabled={save.isPending} className="min-h-11 px-2">{sections[section]}</TabsTrigger>
              ))}
            </TabsList>
          )}
          {(Object.keys(sections) as ExcelApplyGroup[]).map((section) => <TabsContent key={section} value={section} className="space-y-4">
          {section === group && <>
          {!ref && <p className="text-sm text-muted-foreground">Tidak ada data {sections[group].toLowerCase()} yang cocok untuk anggota ini di draf.</p>}
          {ref && detail.isPending && <p role="status" className="text-sm text-muted-foreground">Memuat data sumber…</p>}
          {ref && detail.isError && <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{errorText(detail.error)}</p>
            <Button type="button" variant="outline" onClick={() => void detail.refetch()}>Coba lagi</Button>
          </div>}
          {ref && choices.length > 1 && (
            <label className="block space-y-1 text-sm font-semibold">
              <span>Pilih catatan</span>
              <ExcelSelect value={ref.index} disabled={save.isPending} onChange={(event) => { save.reset(); setSelectedRow(Number(event.target.value)); }}>
                {choices.map((entry) => <option key={entry.index} value={entry.index}>{entry.label}</option>)}
              </ExcelSelect>
            </label>
          )}
          {ref && detail.data && <>
          {kind === "saving" && detail.data.savingEntries && detail.data.savingEntries.length > 1 && (
            <div role="group" aria-label="Saldo yang ingin diperbaiki" className="divide-y overflow-hidden rounded-md border">
              {detail.data.savingEntries.map((entry) => <button key={entry.slot} type="button" aria-pressed={savingEntry?.slot === entry.slot}
                disabled={save.isPending} onClick={() => { save.reset(); setSelectedSlot(entry.slot); }}
                className="flex min-h-11 w-full cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:font-bold aria-pressed:text-accent-foreground disabled:cursor-not-allowed">
                <span>{entry.label}</span>
                <span className="tabular-nums">{entry.amount && /^\d+(?:\.\d{1,2})?$/.test(entry.amount) ? formatRupiahRinci(entry.amount) : entry.amount}</span>
              </button>)}
            </div>
          )}
          <CorrectionForm key={ref.basis + ":" + kind + ":" + (kind === "saving" ? savingEntry?.slot ?? "" : "")} detail={kind === "saving" && savingEntry
            ? { ...detail.data, amount: savingEntry.amount, productId: savingEntry.productId } : detail.data}
            kind={kind} pending={save.isPending} error={save.error} onClose={onClose}
            onSubmit={(value) => save.mutate(value)}
            search={(q) => apiFetch<PickerMember[]>(base + "/member-candidates?" + new URLSearchParams({ unitId, q }))} />
          </>}
          </>}
          </TabsContent>)}
        </Tabs>}
      </DialogContent>
    </Dialog>
  );
}

function CorrectionForm({ detail, kind, pending, error, search, onSubmit, onClose }: {
  detail: ExcelCorrectionDetail;
  kind: ExcelCorrectionInput["kind"];
  pending: boolean;
  error: unknown;
  search: (query: string) => Promise<PickerMember[]>;
  onSubmit: (input: ExcelCorrectionInput) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"link" | "identity">(detail.member ? "link" : "identity");
  const [member, setMember] = useState<PickerMember | null>(detail.member ?? null);
  const [identity, setIdentity] = useState<ExcelCorrectionIdentity>(detail.identity);
  const [productId, setProductId] = useState(detail.productId ?? "");
  const [amount, setAmount] = useState(detail.amount ?? "");
  const [contract, setContract] = useState<ExcelCorrectionLoan | undefined>(detail.contract);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (kind === "member") {
      if (mode === "link" && member) onSubmit({ kind, member: { mode, memberId: member.id } });
      if (mode === "identity") onSubmit({ kind, member: { mode, identity } });
    } else if (kind === "saving") onSubmit({ kind, productId: productId || undefined, amount: amount.trim() });
    else if (contract) onSubmit({ kind, productId: productId || undefined, contract });
  }
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">Sumber · {detail.source.sheet}</p>
      <fieldset disabled={pending} className="space-y-4">
        {kind === "member" ? <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="min-h-11"
              onClick={() => setMode(mode === "link" ? "identity" : "link")}>
              {mode === "identity" ? "Tautkan ke anggota terdaftar" : "Isi identitas dari dokumen"}
            </Button>
          </div>
          {mode === "link" ? <div className="space-y-1.5">
            <label className="text-sm font-semibold" htmlFor="excel-member-correction">Cari anggota</label>
            <MemberPicker inputId="excel-member-correction" selected={member} onSelect={setMember} onClear={() => setMember(null)} search={search} />
            <p className="text-sm text-muted-foreground">Hanya anggota aktif dan terverifikasi di unit yang dipilih yang dapat ditautkan. Periksa kondisi anggota di <Link className="font-semibold underline" to="/members">Daftar anggota</Link>.</p>
          </div> : <>
            <div className="grid gap-3 sm:grid-cols-2">
              {identityFields.map(([key, label]) => {
                const Control = key === "birthDate" ? ExcelDateInput : Input;
                return <label key={key} className="space-y-1 text-sm font-semibold">
                <span>{label}</span>
                <Control required value={identity[key]}
                  inputMode={key === "nik" ? "numeric" : undefined} maxLength={key === "nik" ? 16 : key === "address" ? 500 : 150}
                  pattern={key === "nik" ? "[0-9]{16}" : undefined}
                  onChange={(event) => setIdentity({ ...identity, [key]: event.target.value })} />
              </label>;
              })}
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={identity.isPengurus} onChange={(e) => setIdentity({ ...identity, isPengurus: e.target.checked })} /> Pengurus</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={identity.isPengawas} onChange={(e) => setIdentity({ ...identity, isPengawas: e.target.checked })} /> Pengawas</label>
            </div>
            <p className="text-sm text-muted-foreground">Gunakan data sesuai dokumen anggota. Anggota baru dapat diterapkan dari tab Anggota.</p>
          </>}
        </> : <>
          <label className="block space-y-1 text-sm font-semibold">
            <span>{kind === "saving" ? "Produk simpanan" : "Produk pinjaman"}</span>
            <ExcelSelect value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Cocokkan otomatis dari Excel</option>
              {detail.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </ExcelSelect>
          </label>
          <p className="text-sm text-muted-foreground">Anda dapat menyimpan nilai dulu. Produk harus cocok sebelum data bisa diterapkan. Kelola produk di <Link to="/config" className="font-semibold underline">Pengaturan</Link>.</p>
          {kind === "saving" ? <label className="block space-y-1 text-sm font-semibold">
            <span>Saldo (Rp)</span>
            <Input required inputMode="decimal" pattern="[0-9]{1,13}([.][0-9]{1,2})?" value={amount} onChange={(event) => setAmount(event.target.value)} />
            <span className="text-xs font-normal text-muted-foreground">Gunakan angka tanpa pemisah ribuan.</span>
          </label> : contract && <>
            {detail.source.amounts.length > 0 && <details open className="rounded-md border px-3">
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Nominal di Excel</summary>
              <dl className="divide-y pb-2 text-sm">
                {detail.source.amounts.map((entry, index) => <div key={index} className="flex justify-between gap-3 py-2">
                  <dt>{entry.label}</dt>
                  <dd className="tabular-nums">{typeof entry.value === "number" ? formatRupiahRinci(entry.value) : entry.value}</dd>
                </div>)}
              </dl>
            </details>}
            <div className="grid gap-3 sm:grid-cols-2">
              {loanFields.map(([key, label]) => {
                const Control = key === "disbursedAt" ? ExcelDateInput : Input;
                return <label key={key} className="space-y-1 text-sm font-semibold">
                <span>{label}</span>
                <Control required type={key === "termMonths" ? "number" : "text"}
                  inputMode={key === "contractRef" || key === "disbursedAt" ? undefined : "decimal"}
                  value={key === "termMonths" ? contract.termMonths || "" : contract[key]}
                  onChange={(event) => setContract({ ...contract, [key]: key === "termMonths" ? Number(event.target.value) : event.target.value })} />
              </label>;
              })}
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold">Angsuran tersisa</h3>
              <p className="text-sm text-muted-foreground">Jumlahkan pokok dan imbalan sesuai sisa kewajiban kontrak.</p>
              {contract.schedule.map((line, index) => <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
                {([["dueDate", "Jatuh tempo"], ["principal", "Sisa pokok (Rp)"], ["margin", "Bunga, margin, atau infaq (Rp)"]] as const).map(([key, label]) => {
                  const Control = key === "dueDate" ? ExcelDateInput : Input;
                  return <label key={key} className="space-y-1 text-xs font-semibold">
                    <span>{label}</span>
                    <Control required inputMode={key === "dueDate" ? undefined : "decimal"}
                      value={line[key]} onChange={(event) => setContract({ ...contract, schedule: contract.schedule.map(
                        (entry, i) => i === index ? { ...entry, [key]: event.target.value } : entry
                      ) })} />
                  </label>;
                })}
                <Button type="button" size="sm" variant="ghost" className="justify-self-start"
                  onClick={() => setContract({ ...contract, schedule: contract.schedule.filter((_, i) => i !== index) })}>Hapus angsuran</Button>
              </div>)}
              <Button type="button" size="sm" variant="outline" disabled={contract.schedule.length >= 360}
                onClick={() => setContract({ ...contract, schedule: [...contract.schedule, { dueDate: "", principal: "", margin: "0" }] })}>Tambah angsuran</Button>
            </div>
          </>}
        </>}
      </fieldset>
      {error != null && <p role="alert" className="text-sm text-destructive">{errorText(error)}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Tutup</Button>
        <Button type="submit" loading={pending} disabled={kind === "member" ? mode === "link" && !member :
          kind === "loan" && !contract?.schedule.length}>Simpan koreksi</Button>
      </DialogFooter>
    </form>
  );
}
