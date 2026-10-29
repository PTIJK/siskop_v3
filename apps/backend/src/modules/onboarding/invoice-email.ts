import { emailPayloadSchema, escapeHtml, resendConfiguration, sendResendEmail, type EmailPayload } from "./resend.js";

export interface InvoiceEmailData {
  to: string;
  adminName: string;
  tenantName: string;
  packageName: string;
  billingCycle: "MONTHLY" | "YEARLY";
  invoiceId: string;
  invoiceNumber: string;
  subtotal: string;
  /** Fraction (0.11), or null when the owner has set no VAT. */
  taxRate: string | null;
  taxAmount: string;
  total: string;
  dueDate: Date;
  paymentInstructions: string | null;
}

const idr = (amount: string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(amount));
const date = (d: Date) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(d);

export function buildInvoiceEmail(data: InvoiceEmailData, from: string): EmailPayload {
  const rows: [string, string][] = [
    ["Koperasi", data.tenantName],
    ["Paket", `${data.packageName} (${data.billingCycle === "MONTHLY" ? "bulanan" : "tahunan"})`],
    ["Subtotal", idr(data.subtotal)],
    ...(data.taxRate === null ? [] : ([[`PPN ${Math.round(Number(data.taxRate) * 10000) / 100}%`, idr(data.taxAmount)]] as [string, string][])),
    ["Total", idr(data.total)],
    ["Jatuh tempo", date(data.dueDate)]
  ];
  const instructions = data.paymentInstructions ?? "Petunjuk pembayaran akan dikirim oleh tim SISKOP.";
  const text = [
    `Halo ${data.adminName},`,
    "",
    `Pendaftaran koperasi ${data.tenantName} diterima. Koperasi akan aktif setelah pembayaran faktur ${data.invoiceNumber} dikonfirmasi.`,
    "",
    `Nomor faktur: ${data.invoiceNumber}`,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Cara pembayaran:",
    instructions,
    "",
    "Terima kasih,",
    "Tim SISKOP"
  ].join("\n");
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6f2;font-family:Arial,sans-serif;color:#173b2e">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#fff;border-radius:16px"><tr><td style="padding:36px">
<p style="font-size:15px;font-weight:700;letter-spacing:3px;margin:0 0 32px">SISKOP</p>
<h1 style="font-size:26px;line-height:1.2;margin:0 0 24px">Faktur ${escapeHtml(data.invoiceNumber)}</h1>
<p>Halo ${escapeHtml(data.adminName)},</p>
<p style="line-height:1.7">Pendaftaran koperasi Anda diterima. Koperasi akan aktif setelah pembayaran faktur ini dikonfirmasi.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;font-size:14px">${rows.map(([label, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e7ece8;color:#52685d">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e7ece8;text-align:right">${escapeHtml(value)}</td></tr>`).join("")}</table>
<p style="font-weight:700;margin-bottom:6px">Cara pembayaran</p>
<p style="line-height:1.7;white-space:pre-line">${escapeHtml(instructions)}</p>
<p style="margin-top:32px;line-height:1.7">Terima kasih,<br>Tim SISKOP</p>
</td></tr></table></td></tr></table></body></html>`;
  return emailPayloadSchema.parse({
    from,
    to: [data.to],
    subject: `Faktur ${data.invoiceNumber} — menunggu pembayaran SISKOP`,
    html,
    text,
    tags: [
      { name: "category", value: "registration-invoice" },
      { name: "invoice", value: data.invoiceNumber }
    ]
  });
}

/**
 * Best effort: a registration must not fail because email does. Never throws;
 * the status page shows the same invoice and instructions.
 */
export async function sendInvoiceEmail(data: InvoiceEmailData): Promise<void> {
  try {
    const config = resendConfiguration();
    if (!config) {
      console.warn("Invoice email skipped: Resend is not configured", { invoice: data.invoiceNumber });
      return;
    }
    await sendResendEmail(buildInvoiceEmail(data, config.from), `registration-invoice/${data.invoiceId}`, config.apiKey);
  } catch (error) {
    console.warn("Invoice email not sent", { invoice: data.invoiceNumber, reason: error instanceof Error ? error.message : "unknown" });
  }
}
