import { emailPayloadSchema, escapeHtml, resendConfiguration, sendResendEmail, type EmailPayload } from "../../modules/onboarding/resend.js";
import { db } from "../db.js";

const idr = (amount: string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(amount));
const date = (d: Date) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(d);

interface Layout {
  heading: string;
  greeting: string;
  paragraphs: string[];
  rows: [string, string][];
  /** Shown under the table, e.g. how to pay. */
  note?: { title: string; body: string };
}

function render({ heading, greeting, paragraphs, rows, note }: Layout) {
  const text = [
    greeting,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(note ? ["", `${note.title}:`, note.body] : []),
    "",
    "Terima kasih,",
    "Tim SISKOP"
  ].join("\n");
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6f2;font-family:Arial,sans-serif;color:#173b2e">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#fff;border-radius:16px"><tr><td style="padding:36px">
<p style="font-size:15px;font-weight:700;letter-spacing:3px;margin:0 0 32px">SISKOP</p>
<h1 style="font-size:26px;line-height:1.2;margin:0 0 24px">${escapeHtml(heading)}</h1>
<p>${escapeHtml(greeting)}</p>
${paragraphs.map((p) => `<p style="line-height:1.7">${escapeHtml(p)}</p>`).join("\n")}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;font-size:14px">${rows.map(([label, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e7ece8;color:#52685d">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e7ece8;text-align:right">${escapeHtml(value)}</td></tr>`).join("")}</table>
${note ? `<p style="font-weight:700;margin-bottom:6px">${escapeHtml(note.title)}</p><p style="line-height:1.7;white-space:pre-line">${escapeHtml(note.body)}</p>` : ""}
<p style="margin-top:32px;line-height:1.7">Terima kasih,<br>Tim SISKOP</p>
</td></tr></table></td></tr></table></body></html>`;
  return { html, text };
}

export interface ReceiptEmailData {
  to: string;
  adminName: string;
  tenantName: string;
  invoiceId: string;
  invoiceNumber: string;
  total: string;
  paidAt: Date;
  /** Null when the subscription is not billed again (free package). */
  nextBillingDate: Date | null;
  registration: boolean;
}

export function buildReceiptEmail(data: ReceiptEmailData, from: string): EmailPayload {
  const { html, text } = render({
    heading: `Pembayaran ${data.invoiceNumber} diterima`,
    greeting: `Halo ${data.adminName},`,
    paragraphs: [
      data.registration
        ? `Pembayaran Anda kami terima dan koperasi ${data.tenantName} sekarang aktif. Anda dapat langsung masuk.`
        : `Pembayaran perpanjangan untuk koperasi ${data.tenantName} kami terima. Langganan Anda tetap aktif.`
    ],
    rows: [
      ["Nomor faktur", data.invoiceNumber],
      ["Total dibayar", idr(data.total)],
      ["Tanggal pembayaran", date(data.paidAt)],
      ...(data.nextBillingDate ? ([["Tagihan berikutnya", date(data.nextBillingDate)]] as [string, string][]) : [])
    ]
  });
  return emailPayloadSchema.parse({
    from,
    to: [data.to],
    subject: `Pembayaran ${data.invoiceNumber} diterima — SISKOP`,
    html,
    text,
    tags: [{ name: "category", value: "payment-receipt" }, { name: "invoice", value: data.invoiceNumber }]
  });
}

export interface RenewalEmailData {
  to: string;
  adminName: string;
  tenantName: string;
  invoiceId: string;
  invoiceNumber: string;
  subtotal: string;
  taxRate: string | null;
  taxAmount: string;
  total: string;
  dueDate: Date;
  paymentInstructions: string | null;
  /** "issued" is the 30-day notice that carries the invoice; "reminder" is the 7-day nudge. */
  kind: "issued" | "reminder";
}

export function buildRenewalEmail(data: RenewalEmailData, from: string): EmailPayload {
  const issued = data.kind === "issued";
  const { html, text } = render({
    heading: issued ? `Faktur perpanjangan ${data.invoiceNumber}` : `Pengingat: faktur ${data.invoiceNumber} belum dibayar`,
    greeting: `Halo ${data.adminName},`,
    paragraphs: [
      issued
        ? `Langganan SISKOP koperasi ${data.tenantName} akan berakhir pada ${date(data.dueDate)}. Berikut faktur perpanjangannya.`
        : `Faktur ${data.invoiceNumber} untuk koperasi ${data.tenantName} jatuh tempo pada ${date(data.dueDate)} dan belum kami terima pembayarannya.`
    ],
    rows: [
      ["Nomor faktur", data.invoiceNumber],
      ["Subtotal", idr(data.subtotal)],
      ...(data.taxRate === null ? [] : ([[`PPN ${Math.round(Number(data.taxRate) * 10000) / 100}%`, idr(data.taxAmount)]] as [string, string][])),
      ["Total", idr(data.total)],
      ["Jatuh tempo", date(data.dueDate)]
    ],
    note: { title: "Cara pembayaran", body: data.paymentInstructions ?? "Petunjuk pembayaran akan dikirim oleh tim SISKOP." }
  });
  return emailPayloadSchema.parse({
    from,
    to: [data.to],
    subject: issued ? `Faktur perpanjangan ${data.invoiceNumber} — SISKOP` : `Pengingat pembayaran ${data.invoiceNumber} — SISKOP`,
    html,
    text,
    tags: [{ name: "category", value: issued ? "renewal-invoice" : "renewal-reminder" }, { name: "invoice", value: data.invoiceNumber }]
  });
}

/** Never throws: a billing step must not fail because email does. */
async function sendSafely(build: (from: string) => EmailPayload, key: string, label: string): Promise<boolean> {
  try {
    const config = resendConfiguration();
    if (!config) {
      console.warn("Billing email skipped: Resend is not configured", { email: label });
      return false;
    }
    await sendResendEmail(build(config.from), key, config.apiKey);
    return true;
  } catch (error) {
    console.warn("Billing email not sent", { email: label, reason: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

export const sendReceiptEmail = (data: ReceiptEmailData) => sendSafely((from) => buildReceiptEmail(data, from), `payment-receipt/${data.invoiceId}`, data.invoiceNumber);
export const sendRenewalEmail = (data: RenewalEmailData) => sendSafely((from) => buildRenewalEmail(data, from), `${data.kind === "issued" ? "renewal-invoice" : "renewal-reminder"}/${data.invoiceId}`, data.invoiceNumber);

/** The person billing mail goes to: the tenant's oldest active Super Admin. */
export async function findBillingContact(tenantId: string) {
  return db.user.findFirst({
    where: { tenantId, isActive: true, role: { name: "Super Admin" } },
    orderBy: { createdAt: "asc" },
    select: { name: true, email: true }
  });
}
