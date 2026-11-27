import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExcelApplyGroup, ExcelApplyItem, ExcelApplyOptions, ExcelApplyReceipt, ExcelApplyReview, ExcelApplySettings } from "@siskop/types";
import { apiFetch, apiPost } from "@/api/client";
import { matchesQuery } from "@/components/layout/nav";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { formatRupiahRinci, formatTanggalIndonesia } from "@/lib/format";
import { ExcelCorrectionDialog } from "./ExcelCorrectionDialog";
import { ExcelDateInput, ExcelSelect } from "./ExcelImportFields";

const labels = { anggota: "Anggota", simpanan: "Simpanan", pinjaman: "Pinjaman" } as const;
const moduleByGroup = { anggota: "members", simpanan: "savings", pinjaman: "loans" } as const;
const statuses = { ready: "Siap ditambahkan", existing: "Sudah ada", review: "Perlu diperiksa" } as const;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Terjadi kendala. Coba lagi.";

function ReviewList({ review, search, onSearch, onFix }: {
  review: ExcelApplyReview; search: string; onSearch: (value: string) => void; onFix: (item: ExcelApplyItem, trigger: HTMLButtonElement) => void;
}) {
  const [status, setStatus] = useState<ExcelApplyItem["status"]>(review.ready ? "ready" : review.items.some((item) => item.status === "review") ? "review" : "existing");
  const [limit, setLimit] = useState(20);
  const matches = review.items.filter((item) => item.status === status && matchesQuery(item.name, search));
  const sharedReason = status === "review" && matches.length > 1 && matches.every((item) => item.description === matches[0]?.description)
    ? matches[0]?.description : undefined;
  return (
    <Tabs value={status} onValueChange={(value) => { setStatus(value as ExcelApplyItem["status"]); setLimit(20); }}
      className="overflow-hidden rounded-lg border">
      <TabsList aria-label="Status verifikasi" className="grid h-auto w-full grid-cols-3 items-stretch gap-1 rounded-none border-b bg-muted/35 px-2 pb-0 pt-1">
        {(Object.keys(statuses) as ExcelApplyItem["status"][]).map((key) => (
          <TabsTrigger key={key} value={key}
            className="group min-h-11 flex-wrap gap-x-2 gap-y-0.5 whitespace-normal rounded-none border-b-2 border-transparent px-1.5 text-xs hover:text-foreground data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:text-sm">
            <span>{statuses[key]}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-foreground">
              {review.items.filter((item) => item.status === key).length.toLocaleString("id-ID")}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
      {(Object.keys(statuses) as ExcelApplyItem["status"][]).map((key) => <TabsContent key={key} value={key} className="mt-0">
      {key === status && <>
      <div className="border-b p-3 sm:px-4">
        <Input type="search" aria-label="Cari nama di hasil verifikasi" placeholder="Cari nama di hasil verifikasi"
          className="max-w-sm" value={search} onChange={(event) => { onSearch(event.target.value); setLimit(20); }} />
      </div>
      {!matches.length && <p className="px-4 py-3 text-sm text-muted-foreground">
        {search.trim() ? "Tidak ada hasil untuk nama ini." : "Belum ada data dalam kelompok ini."}
      </p>}
      {sharedReason && <p className="border-b px-4 py-3 text-sm text-muted-foreground">{sharedReason}</p>}
      <ul className="divide-y">
        {matches.slice(0, limit).map((item, i) => (
          <li key={i} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="break-words font-bold">{item.name}</p>
              {!sharedReason && <p className="break-words text-muted-foreground">{item.description}</p>}
            </div>
            {item.amount && <div className="tabular-nums">
              <p className="font-semibold">{item.remainingAmount && "Sisa pokok · "}{formatRupiahRinci(item.amount)}</p>
              {item.remainingAmount && <p className="text-muted-foreground">Sisa kewajiban · {formatRupiahRinci(item.remainingAmount)}</p>}
            </div>}
            {item.fix && <Button type="button" variant="outline" size="sm" aria-label={"Perbaiki data " + item.name}
              className="min-h-11" onClick={(event) => onFix(item, event.currentTarget)}>Perbaiki</Button>}
          </li>
        ))}
      </ul>
      {matches.length > limit && <div className="border-t p-3"><Button variant="outline" size="sm" onClick={() => setLimit(limit + 20)}>Tampilkan lebih banyak</Button></div>}
      </>}
      </TabsContent>)}
    </Tabs>
  );
}

export function ExcelApplyPanel({ draftId }: { draftId: string }) {
  const base = "/excel-imports/" + encodeURIComponent(draftId) + "/apply";
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const optionsKey = ["excel-apply", draftId];
  const options = useQuery({ queryKey: optionsKey, queryFn: () => apiFetch<ExcelApplyOptions>(base), gcTime: 0, retry: false });
  const [group, setGroup] = useState<ExcelApplyGroup>("anggota");
  const [unitId, setUnitId] = useState("");
  const [editedDates, setEditedDates] = useState<Partial<Record<"simpanan" | "pinjaman", string>>>({});
  const [confirm, setConfirm] = useState(false);
  const [fixing, setFixing] = useState<(ExcelApplyItem & { fix: NonNullable<ExcelApplyItem["fix"]> }) | null>(null);
  const [correctionSaved, setCorrectionSaved] = useState(false);
  const [reviewSearch, setReviewSearch] = useState("");
  const correctionTrigger = useRef<HTMLButtonElement | null>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const financial = group !== "anggota";
  const selectedUnit = unitId || (options.data?.units.length === 1 ? options.data.units[0]?.id ?? "" : "");
  const detectedDate = financial ? options.data?.balanceDates[group] : undefined;
  const cutoffDate = financial ? editedDates[group] ?? detectedDate ?? "" : "";
  const settings: ExcelApplySettings = financial ? { group, unitId: selectedUnit, cutoffDate: cutoffDate || undefined } : { group, unitId: selectedUnit };
  const preview = useMutation({
    mutationFn: (input: ExcelApplySettings) => apiPost<ExcelApplyReview>(base + "/preview", input)
  });
  const commit = useMutation({
    mutationFn: (payload: { settings: ExcelApplySettings; token: string }) => apiPost<ExcelApplyReceipt>(base + "/commit", payload),
    onSuccess: () => {
      setConfirm(false);
      preview.reset();
      void queryClient.invalidateQueries({ queryKey: optionsKey });
    }
  });
  const inputLocked = preview.isPending || commit.isPending;
  const canApply = can(moduleByGroup[group], "create");
  const review = preview.data;
  const shownReceipt = commit.data?.group === group ? commit.data : undefined;
  function onPreview(event: FormEvent) {
    event.preventDefault();
    setCorrectionSaved(false);
    commit.reset();
    preview.mutate(settings);
  }

  function changeDate(date: string) {
    if (!financial) return;
    preview.reset();
    setEditedDates((previous) => ({ ...previous, [group]: date }));
  }

  return (
    <section aria-labelledby="verify-excel-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 id="verify-excel-heading" className="text-lg font-extrabold">Verifikasi sebelum menerapkan</h2>
        <p className="mt-1 text-sm text-muted-foreground">Mulai dari Anggota. Setelah anggota terdaftar, periksa Simpanan dan Pinjaman.</p>
      </div>
      {options.isPending && <p role="status" className="text-sm text-muted-foreground">Memuat pilihan…</p>}
      {options.isError && <p role="alert" className="text-sm text-destructive">{errorText(options.error)}</p>}
      {options.data && (
        <form onSubmit={onPreview} className="space-y-3">
          <fieldset disabled={inputLocked} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold">
              <span>Jenis data</span>
              <ExcelSelect value={group}
                onChange={(event) => { preview.reset(); commit.reset(); setGroup(event.target.value as ExcelApplyGroup); }}>
                {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </ExcelSelect>
            </label>
            <label className="space-y-1 text-sm font-semibold">
              <span>Unit koperasi</span>
              <ExcelSelect value={selectedUnit} required
                onChange={(event) => { preview.reset(); setUnitId(event.target.value); }}>
                <option value="">Pilih unit</option>
                {options.data.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </ExcelSelect>
            </label>
            {financial && <div className="space-y-1.5">
              <label className="block space-y-1 text-sm font-semibold">
                <span>Saldo per tanggal</span>
                <ExcelDateInput value={cutoffDate} max={options.data.today} aria-describedby="excel-balance-date-hint"
                  onChange={(event) => changeDate(event.target.value)} />
              </label>
              <p id="excel-balance-date-hint" className="text-sm text-muted-foreground">
                {detectedDate && cutoffDate === detectedDate
                  ? "Diisi dari tanggal laporan Excel. Periksa sebelum menerapkan."
                  : "Gunakan tanggal saldo di laporan atau tanggal saldo terakhir dicocokkan. Anda bisa memeriksa data sebelum mengisi tanggal."}
              </p>
              {!cutoffDate && <Button type="button" size="sm" variant="ghost" onClick={() => changeDate(options.data.today)}>
                Gunakan hari ini jika saldo masih sesuai
              </Button>}
            </div>}
          </fieldset>
          <Button ref={previewTrigger} type="submit" variant="outline" loading={preview.isPending} disabled={commit.isPending}>Periksa {labels[group]}</Button>
        </form>
      )}
      {preview.isError && <p role="alert" className="text-sm text-destructive">{errorText(preview.error)}</p>}
      {correctionSaved && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm font-semibold">Koreksi tersimpan di draf.</p>}
      {review && <>
        {review.postingIssue && (review.ready > 0 || cutoffDate) && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">{review.postingIssue}</p>}
        {review.products.length > 0 && <dl className="divide-y rounded-lg border bg-muted/35 px-3 text-sm">
          {review.products.map((product) => (
            <div key={product.name} className="flex flex-wrap justify-between gap-x-3 py-2.5">
              <dt className="font-semibold">{product.name} · {product.count} data</dt>
              <dd className="tabular-nums">{formatRupiahRinci(product.amount)}</dd>
            </div>
          ))}
        </dl>}
        <ReviewList key={preview.submittedAt} review={review} search={reviewSearch} onSearch={setReviewSearch} onFix={(item, trigger) => {
          if (item.fix) {
            correctionTrigger.current = trigger;
            setFixing({ ...item, fix: item.fix });
          }
        }} />
        {review.items.some((item) => item.status === "review") && (
          <p className="text-sm text-muted-foreground">Pilih Perbaiki untuk melihat masalah dan menyimpan koreksi di draf.</p>
        )}
        {review.token && canApply && (
          <AlertDialog open={confirm} onOpenChange={(open) => { if (!commit.isPending) setConfirm(open); }}>
            <AlertDialogTrigger asChild>
              <Button variant="brand">Terapkan {review.ready} {group === "anggota" ? "anggota" : group === "simpanan" ? "rekening simpanan" : "pinjaman"}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Terapkan {review.ready} data {labels[group].toLowerCase()}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {financial
                    ? <>Saldo awal {group === "pinjaman" ? "sisa pokok " : ""}{formatRupiahRinci(review.total)} per {cutoffDate} akan dicatat otomatis ke pembukuan. Pastikan saldo ini belum pernah dibukukan. Data yang perlu diperiksa tetap di draf.</>
                    : "Anggota baru masuk ke daftar anggota unit yang dipilih. Data yang perlu diperiksa tetap di draf."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {commit.isError && <p role="alert" className="text-sm text-destructive">{errorText(commit.error)}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={commit.isPending}>Kembali</AlertDialogCancel>
                <AlertDialogAction disabled={commit.isPending} onClick={(event) => {
                  event.preventDefault();
                  if (review.token) commit.mutate({ settings, token: review.token });
                }}>{commit.isPending ? "Menerapkan…" : "Terapkan ke sistem"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {review.ready > 0 && !canApply && <p className="text-sm text-muted-foreground">Perlu izin tambah {labels[group].toLowerCase()} untuk menerapkan data.</p>}
      </>}
      {fixing && <ExcelCorrectionDialog base={base} unitId={selectedUnit} cutoffDate={cutoffDate || undefined} item={fixing}
        onClose={() => setFixing(null)} restoreFocus={() => {
          if (correctionTrigger.current?.isConnected) correctionTrigger.current.focus();
          else previewTrigger.current?.focus();
        }} onSaved={() => {
          setFixing(null);
          setCorrectionSaved(true);
          preview.reset();
          preview.mutate(settings);
        }} />}
      {shownReceipt && <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm font-semibold">{shownReceipt.count} data berhasil diterapkan.</p>}
      {!!options.data?.receipts.length && (
        <div className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-extrabold">Riwayat penerapan</h3>
          <ul className="divide-y text-sm">
            {options.data.receipts.map((item) => (
              <li key={item.id} className="py-2">
                <p className="font-semibold">{labels[item.group]} · {item.count} data · {item.unit}</p>
                <p className="text-muted-foreground">
                  {formatTanggalIndonesia(item.createdAt)}
                  {item.cutoffDate && <> · {formatRupiahRinci(item.total)} · Saldo awal {item.cutoffDate}</>}
                  {item.journalEntryNos.length > 0 && <> · Jurnal {item.journalEntryNos.join(", ")}</>}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
