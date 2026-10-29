import type { InvoiceStatus, InvoiceType, PlatformInvoice } from "@siskop/types";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  OPEN: "Menunggu pembayaran",
  PAID: "Lunas",
  EXPIRED: "Kedaluwarsa",
  VOID: "Dibatalkan"
};

const TYPE_LABEL: Record<InvoiceType, string> = {
  REGISTRATION: "Pendaftaran",
  RENEWAL: "Perpanjangan",
  ADDON: "Add-on",
  SUPPORT: "Dukungan"
};

export const statusLabel = (status: InvoiceStatus): string => STATUS_LABEL[status];
export const typeLabel = (type: InvoiceType): string => TYPE_LABEL[type];
export const INVOICE_STATUSES = Object.keys(STATUS_LABEL) as InvoiceStatus[];

/**
 * What the owner may do with an invoice. Mirrors the server's rules so a button
 * is never offered that would only return an error: a renewal cannot be
 * reissued (void it and the next billing run issues a fresh one).
 */
export function invoiceActions(invoice: Pick<PlatformInvoice, "status" | "type">) {
  const open = invoice.status === "OPEN";
  return {
    markPaid: open,
    void: open,
    reissue: invoice.type === "REGISTRATION" && (open || invoice.status === "EXPIRED")
  };
}

const DAY_MS = 86_400_000;

/** Whole days an open invoice is past its due date; 0 when it is not late. */
export function daysOverdue(invoice: Pick<PlatformInvoice, "status" | "dueDate">, now: Date = new Date()): number {
  if (invoice.status !== "OPEN") return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / DAY_MS));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today as YYYY-MM-DD in the browser's timezone, for a date field's max. */
export function todayInputValue(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The payment date to send. Today (or nothing) is left out so the server stamps
 * the real moment; an earlier day is sent as noon that day, which cannot slip
 * into a neighbouring date in any timezone.
 */
export function paidAtFromInput(input: string, now: Date = new Date()): string | undefined {
  if (input === "" || input === todayInputValue(now)) return undefined;
  const [y, m, d] = input.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number, 12, 0, 0).toISOString();
}
