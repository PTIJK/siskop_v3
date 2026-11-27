import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileSpreadsheet, Search, Upload } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  EXCEL_IMPORT_GROUPS,
  type ExcelImportDraft,
  type ExcelImportField,
  type ExcelImportGroup,
  type ExcelImportRecord,
  type ExcelImportSummary
} from "@siskop/types";
import { apiFetch, apiUpload } from "@/api/client";
import { matchesQuery } from "@/components/layout/nav";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { formatRupiahRinci, formatTanggalIndonesia } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import { ExcelApplyPanel } from "./ExcelApplyPanel";

const HOME = "/impor-excel";
const API = "/excel-imports";
const PAGE_SIZE = 25;
const labels: Record<ExcelImportGroup, string> = {
  anggota: "Anggota",
  simpanan: "Simpanan",
  pinjaman: "Pinjaman",
  neraca: "Neraca",
  kas: "Saldo Kas",
  lainnya: "Data lainnya"
};
const primaryGroups: ExcelImportGroup[] = ["anggota", "simpanan", "pinjaman"];
const integer = new Intl.NumberFormat("id-ID");

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kendala. Coba lagi.";
}

function Pagination({ page, setPage, hasNext }: { page: number; setPage: (page: number) => void; hasNext: boolean }) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav aria-label="Halaman hasil" className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
      <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
      <span className="px-1 text-sm tabular-nums text-muted-foreground" aria-live="polite">Halaman {page}</span>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage(page + 1)}>Berikutnya</Button>
    </nav>
  );
}

function ImportInbox({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [fileError, setFileError] = useState("");
  const queryKey = ["excel-imports", tenantId];
  const history = useQuery({
    queryKey: [...queryKey, page],
    queryFn: () => apiFetch<{ drafts: ExcelImportSummary[]; hasMore: boolean }>(API + "?page=" + page)
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiUpload<ExcelImportSummary>(API, form);
    },
    onSuccess: (draft) => {
      void queryClient.invalidateQueries({ queryKey });
      navigate(HOME + "/" + draft.id);
    }
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader title="Impor Data Excel" description="Baca data dari Excel dan simpan hasilnya sebagai draf untuk diperiksa." />

      <section aria-labelledby="upload-heading" className="rounded-xl border bg-card p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <FileSpreadsheet className="size-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="upload-heading" className="text-lg font-extrabold">Unggah file Excel</h2>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Satu file boleh memuat daftar anggota, saldo simpanan, dan pinjaman sekaligus. Data yang terbaca langsung tersimpan sebagai draf.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (!file) return;
                  upload.reset();
                  setFileError("");
                  if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
                    setFileError("Pilih file .xlsx dengan ukuran maksimal 10 MB.");
                    return;
                  }
                  upload.mutate(file);
                }}
              />
              <Button variant="brand" aria-describedby="upload-format" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
                <Upload aria-hidden="true" /> Pilih file Excel
              </Button>
              <span id="upload-format" className="text-xs text-muted-foreground">.xlsx · Maks. 10 MB</span>
            </div>
            {upload.isPending && <p role="status" className="mt-3 text-sm text-muted-foreground">Membaca dan menyimpan draf…</p>}
            {(fileError || upload.isError) && <p role="alert" className="mt-3 text-sm text-destructive">{fileError || errorText(upload.error)}</p>}
          </div>
        </div>
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-lg font-extrabold">Draf tersimpan</h2>
        <div className="overflow-hidden rounded-xl border bg-card">
          {history.isPending && <p role="status" className="p-5 text-sm text-muted-foreground">Memuat draf…</p>}
          {history.isError && (
            <div className="space-y-3 p-5">
              <p role="alert" className="text-sm text-destructive">{errorText(history.error)}</p>
              <Button variant="outline" size="sm" onClick={() => void history.refetch()}>Coba lagi</Button>
            </div>
          )}
          {history.data && (history.data.drafts.length ? (
            <>
              <ul className="divide-y">
                {history.data.drafts.map((draft) => (
                  <li key={draft.id}>
                    <Link to={HOME + "/" + draft.id} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
                      <FileSpreadsheet className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-bold">{draft.fileName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatTanggalIndonesia(draft.createdAt)}</p>
                      </div>
                      <span className="text-sm font-semibold text-muted-foreground max-sm:sr-only">Buka draf</span>
                      <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination page={page} setPage={setPage} hasNext={history.data.hasMore} />
            </>
          ) : <p className="p-5 text-sm text-muted-foreground">Belum ada draf. Unggah file Excel untuk mulai.</p>)}
        </div>
      </section>
    </div>
  );
}

function CapturedFields({ fields }: { fields: ExcelImportField[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {fields.map(({ label, value, kind }, index) => (
        <div key={index} className="min-w-0">
          <dt className="break-words text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words text-sm font-semibold tabular-nums">
            {kind === "nik" ? "•••• •••• •••• " + String(value).slice(-4)
              : typeof value === "number" && kind === "money" ? formatRupiahRinci(value)
              : typeof value === "number" && label.toLowerCase() === "keterangan" ? value.toLocaleString("id-ID")
              : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CapturedRecord({ record, group }: { record: ExcelImportRecord; group: ExcelImportGroup }) {
  const financial = group !== "anggota" && group !== "lainnya";
  const isTotal = (field: ExcelImportField) => field.kind === "money" && /^Total (?:Simpanan|Tabungan)\b/i.test(field.label);
  const ordered = financial
    ? [...record.fields.filter(isTotal), ...record.fields.filter((field) => field.kind === "money" && !isTotal(field)), ...record.fields.filter((field) => field.kind !== "money")]
    : record.fields;
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="grid gap-2.5 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] sm:gap-5">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-extrabold">{record.title}</h3>
          {record.notes.length > 0 && <p className="mt-1 break-words text-xs text-muted-foreground">{record.notes[0]}</p>}
        </div>
        <CapturedFields fields={ordered.slice(0, 3)} />
      </div>
      {(ordered.length > 3 || record.notes.length > 1 || group === "lainnya") && (
        <details className="mt-2">
          <summary className="w-fit cursor-pointer rounded-sm py-1 text-xs font-bold text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-ring">Lihat rincian</summary>
          <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3">
            <p className="break-words text-xs text-muted-foreground">Sumber · {record.sheet}</p>
            <CapturedFields fields={ordered.slice(3)} />
            {record.notes.slice(1).map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
          </div>
        </details>
      )}
    </li>
  );
}

function CapturedGroup({ records, group, searching }: { records: ExcelImportRecord[]; group: ExcelImportGroup; searching: boolean }) {
  const [page, setPage] = useState(1);
  if (!records.length) {
    return <p className="p-5 text-sm text-muted-foreground">
      {searching ? "Tidak ada hasil untuk nama ini." : `Data ${labels[group].toLowerCase()} belum terdeteksi di file ini.`}
    </p>;
  }
  return (
    <>
      <ul className="divide-y">
        {records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((record, index) => (
          <CapturedRecord key={(page - 1) * PAGE_SIZE + index} record={record} group={group} />
        ))}
      </ul>
      <Pagination page={page} setPage={setPage} hasNext={page * PAGE_SIZE < records.length} />
    </>
  );
}

function ImportReview({ id, tenantId }: { id: string; tenantId: string }) {
  const [nameSearch, setNameSearch] = useState("");
  const [showVerification, setShowVerification] = useState(false);
  const draft = useQuery({
    queryKey: ["excel-import", tenantId, id],
    queryFn: () => apiFetch<ExcelImportDraft>(API + "/" + encodeURIComponent(id)),
    gcTime: 0
  });
  const data = draft.data;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={HOME}><ArrowLeft aria-hidden="true" /> Semua draf</Link>
      </Button>
      <PageHeader title="Tinjau hasil impor" description="Periksa data yang terbaca. Hasil ini tersimpan sebagai draf dan bisa Anda buka kembali kapan saja."
        actions={data && <Button variant={showVerification ? "outline" : "brand"} onClick={() => setShowVerification(!showVerification)}>
          {showVerification ? "Kembali ke hasil impor" : "Verifikasi data"}
        </Button>} />
      {draft.isPending && <p role="status" className="text-sm text-muted-foreground">Memuat draf…</p>}
      {draft.isError && (
        <div className="space-y-3 rounded-xl border bg-card p-5">
          <p role="alert" className="text-sm text-destructive">{errorText(draft.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void draft.refetch()}>Coba lagi</Button>
        </div>
      )}
      {data && showVerification && <ExcelApplyPanel draftId={id} />}
      {data && !showVerification && (
        <section aria-labelledby="review-filename" className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border bg-card p-4 sm:items-center sm:px-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <FileSpreadsheet className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="review-filename" className="break-words text-sm font-extrabold sm:text-base">{data.fileName}</h2>
              <p className="text-xs text-muted-foreground">{formatTanggalIndonesia(data.createdAt)}</p>
            </div>
            <Badge variant="secondary" className="shrink-0">Draf tersimpan</Badge>
          </div>
          {data.limited && (
            <p className="rounded-lg border bg-muted/50 p-3 text-sm">
              Draf berisi sebagian isi file karena ukurannya besar. Bagi data menjadi beberapa file Excel untuk membaca sisanya.
            </p>
          )}
          <Tabs defaultValue={EXCEL_IMPORT_GROUPS.find((group) => data.counts[group] > 0) ?? "anggota"}>
            <TabsList aria-label="Jenis data yang terbaca" className="h-auto w-fit max-w-full flex-wrap gap-1 overflow-visible">
              {EXCEL_IMPORT_GROUPS.filter((group) => primaryGroups.includes(group) || data.counts[group] > 0).map((group) => (
                <TabsTrigger key={group} value={group} className="min-h-11 gap-1.5 px-2.5 transition-none sm:px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  {labels[group]} <span className="text-xs tabular-nums opacity-85">{integer.format(data.counts[group])}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {EXCEL_IMPORT_GROUPS.filter((group) => primaryGroups.includes(group) || data.counts[group] > 0).map((group) => {
              const canSearch = primaryGroups.includes(group);
              const query = canSearch ? nameSearch.trim().toLowerCase() : "";
              const records = query ? data.records[group].filter((record) => matchesQuery(record.title, query)) : data.records[group];
              return (
                <TabsContent key={group} value={group} className="rounded-xl border bg-card">
                  {canSearch && (
                    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5">
                      <div className="relative w-full sm:max-w-sm">
                        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="search"
                          aria-label="Cari nama anggota"
                          placeholder="Cari nama anggota"
                          className="min-h-11 pl-9"
                          value={nameSearch}
                          onChange={(event) => setNameSearch(event.target.value)}
                        />
                      </div>
                      <span role="status" className="text-sm tabular-nums text-muted-foreground">
                        {query && `${integer.format(records.length)} hasil`}
                      </span>
                    </div>
                  )}
                  <CapturedGroup key={query} records={records} group={group} searching={Boolean(query)} />
                </TabsContent>
              );
            })}
          </Tabs>
        </section>
      )}
    </div>
  );
}

export default function ExcelImportPage() {
  const { id } = useParams();
  const { can } = usePermissions();
  const user = useAuth((state) => state.user);
  if (!user || user.role !== "tenant_admin" || !can("config", "update")) {
    return <PageHeader title="Impor Data Excel" description="Halaman ini tersedia untuk admin koperasi." />;
  }
  return id ? <ImportReview key={id} id={id} tenantId={user.tenantId} /> : <ImportInbox tenantId={user.tenantId} />;
}
