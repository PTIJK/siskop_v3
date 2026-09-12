import { z } from "zod";
import type { RegistrationConfirmation } from "@siskop/types";

export const emailPayloadSchema = z.object({
  from: z.string().min(1),
  to: z.array(z.string().email()).length(1),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.object({ name: z.string(), value: z.string() }))
});
type EmailPayload = z.infer<typeof emailPayloadSchema>;

export function resendConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) return null;
  const address = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  const origin = new URL(process.env.PUBLIC_APP_URL ?? "");
  if (!z.string().email().safeParse(address).success || /[\r\n]/.test(from) || origin.protocol !== "https:" || origin.username || origin.password)
    throw new Error("RESEND_CONFIGURATION_INVALID");
  return { apiKey, from, loginUrl: new URL("/login", origin.origin).href };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]!);

export function buildRegistrationEmail(data: RegistrationConfirmation, from: string, loginUrl: string): EmailPayload {
  // Onboarding charges whole rupiah. Keep the Decimal snapshot as a string.
  const amount = "Rp " + data.amount.split(".")[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const method = data.authProvider === "google.com" ? "akun Google yang digunakan saat mendaftar" : "email dan kata sandi yang digunakan saat mendaftar";
  const text = `Halo ${data.adminName},\n\nPendaftaran SISKOP berhasil. Pembayaran paket ${data.packageName} telah terverifikasi dan koperasi ${data.tenantName} sudah aktif.\n\nPaket: ${data.packageName}\nPembayaran: ${amount}\nID pendaftaran: ${data.orderId}\n\nMasuk menggunakan ${method}:\n${loginUrl}\n\nTerima kasih,\nTim SISKOP`;
  const rows = [["Koperasi", data.tenantName], ["Paket", data.packageName], ["Pembayaran", amount], ["ID pendaftaran", data.orderId]];
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6f2;font-family:Arial,sans-serif;color:#173b2e">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#fff;border-radius:16px"><tr><td style="padding:36px">
<p style="font-size:15px;font-weight:700;letter-spacing:3px;margin:0 0 32px">SISKOP</p>
<h1 style="font-size:30px;line-height:1.2;margin:0 0 24px">Koperasi Anda siap bertumbuh.</h1>
<p>Halo ${escapeHtml(data.adminName)},</p><p style="line-height:1.7">Pendaftaran berhasil. Pembayaran Anda telah terverifikasi dan koperasi Anda sudah aktif.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;font-size:14px">${rows.map(([label, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e7ece8;color:#52685d">${label}</td><td style="padding:10px 0 10px;border-bottom:1px solid #e7ece8;text-align:right;overflow-wrap:anywhere">${escapeHtml(value!)}</td></tr>`).join("")}</table>
<p style="line-height:1.7">Masuk menggunakan ${method}.</p>
<p style="margin:28px 0"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#173b2e;color:#fff;text-decoration:none;padding:15px 24px;border-radius:8px;font-weight:700">Masuk ke SISKOP</a></p>
<p style="font-size:12px;line-height:1.7;color:#52685d">Jika tombol tidak terbuka, kunjungi <a href="${escapeHtml(loginUrl)}" style="color:#173b2e">${escapeHtml(loginUrl)}</a>.</p>
<p style="margin-top:32px;line-height:1.7">Terima kasih,<br>Tim SISKOP</p>
</td></tr></table></td></tr></table></body></html>`;
  return emailPayloadSchema.parse({ from, to: [data.email], subject: "Pendaftaran SISKOP berhasil — koperasi Anda sudah aktif", html, text,
    tags: [{ name: "category", value: "registration-complete" }, { name: "registration_id", value: data.orderId }] });
}

export async function sendRegistrationEmail(payload: EmailPayload, orderId: string, apiKey: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `registration-complete/${orderId}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new Error("RESEND_UNCONFIRMED");
  }
  if (!response.ok) throw new Error(`RESEND_HTTP_${response.status}`);
  try {
    return z.object({ id: z.string().min(1) }).parse(await response.json()).id;
  } catch {
    throw new Error("RESEND_UNCONFIRMED");
  }
}
