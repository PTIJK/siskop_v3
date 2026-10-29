import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { InvoiceStatus, PlatformInvoice, PlatformInvoiceList } from "@siskop/types";
import { apiFetch, apiPost } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/hooks/use-toast";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { FormError } from "@/components/shared/FormError";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "./pricing/pricingUi";
import { daysOverdue, INVOICE_STATUSES, invoiceActions, statusLabel, typeLabel } from "./invoices/invoiceAdmin";
import { MarkPaidDialog } from "./invoices/MarkPaidDialog";

const PAGE_SIZE = 25;
const ALL = "ALL";
const STATUS_VARIANT: Record<InvoiceStatus, "default" | "secondary" | "outline" | "destructive"> = {
  PAID: "default",
  OPEN: "secondary",
  VOID: "outline",
  EXPIRED: "destructive"
};

type Pending = { kind: "void" | "reissue"; invoice: PlatformInvoice };

export function PlatformInvoicesPage() {
  const role = useAuth((s) => s.user?.role);
  const { toast } = useToast();
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<PlatformInvoice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [actionError, setActionError] = useState("");

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status !== ALL) params.set("status", status);
  if (search.trim()) params.set("q", search.trim());

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["platform", "invoices", status, search.trim(), page],
    queryFn: () => apiFetch<PlatformInvoiceList>(`/platform/invoices?${params.toString()}`)
  });

  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  const runPending = async () => {
    if (!pending) return;
    setActionError("");
    try {
      await apiPost(`/platform/invoices/${pending.invoice.id}/${pending.kind}`, {});
      toast({ title: pending.kind === "void" ? "Faktur dibatalkan" : "Faktur diterbitkan ulang", description: pending.invoice.number });
      await refetch();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const columns: ColumnDef<PlatformInvoice>[] = [
    {
      header: "Faktur",
      cell: ({ row: { original: i } }) => (
        <div>
          <p className="font-medium">{i.number}</p>
          <p className="text-xs text-muted-foreground">{typeLabel(i.type)}</p>
        </div>
      )
    },
    {
      header: "Koperasi",
      cell: ({ row: { original: i } }) => (
        <div>
          <p>{i.tenant.name}</p>
          <p className="text-xs text-muted-foreground">
            {i.packageName} · {i.billingCycle === "MONTHLY" ? "bulanan" : "tahunan"}
          </p>
        </div>
      )
    },
    {
      header: "Total",
      className: "text-right",
      cell: ({ row: { original: i } }) => (
        <div className="text-right">
          <p className="font-medium">{formatRupiah(i.total)}</p>
          {i.taxRate !== null && <p className="text-xs text-muted-foreground">termasuk PPN {formatRupiah(i.taxAmount)}</p>}
        </div>
      )
    },
    {
      header: "Jatuh tempo",
      cell: ({ row: { original: i } }) => {
        const late = daysOverdue(i);
        return (
          <div>
            <p>{formatTanggalPendek(i.dueDate)}</p>
            {late > 0 && <p className="text-xs text-destructive">terlambat {late} hari</p>}
          </div>
        );
      }
    },
    {
      header: "Status",
      cell: ({ row: { original: i } }) => (
        <div className="space-y-1">
          <Badge variant={STATUS_VARIANT[i.status]}>{statusLabel(i.status)}</Badge>
          {i.paidAt && <p className="text-xs text-muted-foreground">{formatTanggalPendek(i.paidAt)}</p>}
        </div>
      )
    },
    {
      header: "",
      className: "text-right",
      cell: ({ row: { original: i } }) => {
        const can = invoiceActions(i);
        return (
          <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {can.markPaid && (
              <Button size="sm" onClick={() => setPaying(i)}>
                Tandai lunas
              </Button>
            )}
            {can.reissue && (
              <Button size="sm" variant="outline" onClick={() => setPending({ kind: "reissue", invoice: i })}>
                Terbitkan ulang
              </Button>
            )}
            {can.void && (
              <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "void", invoice: i })}>
                Batalkan
              </Button>
            )}
          </div>
        );
      }
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Faktur" description="Faktur langganan koperasi. Setelah uang masuk, tandai lunas agar koperasi aktif atau langganannya diperpanjang." />
      <FormError error={actionError} />
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        getRowKey={(i) => i.id}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        emptyMessage="Belum ada faktur"
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v);
            setPage(1);
          },
          placeholder: "Cari faktur atau koperasi"
        }}
        pagination={{ page, limit: PAGE_SIZE, total: data?.total ?? 0, onPageChange: setPage }}
        headerActions={
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-52" aria-label="Filter status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua status</SelectItem>
              {INVOICE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <MarkPaidDialog invoice={paying} onClose={() => setPaying(null)} onDone={() => void refetch()} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.kind === "void" ? "Batalkan faktur?" : "Terbitkan ulang faktur?"}
        description={
          pending?.kind === "void"
            ? `${pending.invoice.number} dibatalkan dan tidak bisa dibayar lagi. Untuk faktur perpanjangan, proses penagihan berikutnya menerbitkan faktur baru dengan tarif PPN terbaru.`
            : `${pending?.invoice.number ?? ""} dibatalkan dan diganti faktur baru bernomor baru dengan batas pembayaran diperpanjang. Koperasi diberi tahu lewat email.`
        }
        confirmLabel={pending?.kind === "void" ? "Batalkan faktur" : "Terbitkan ulang"}
        variant={pending?.kind === "void" ? "destructive" : "default"}
        onConfirm={runPending}
      />
    </div>
  );
}
