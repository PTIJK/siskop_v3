import { emailPayloadSchema, type EmailPayload } from "../../modules/onboarding/resend.js";
import { render, sendSafely } from "../payments/emails.js";

const percent = (rate: string) => `${Number((Number(rate) * 100).toFixed(2))}%`;

function build(from: string, to: string, subject: string, tag: string, layout: Parameters<typeof render>[0]): EmailPayload {
  const { html, text } = render(layout);
  return emailPayloadSchema.parse({ from, to: [to], subject, html, text, tags: [{ name: "category", value: tag }] });
}

export interface PartnerReceivedEmailData {
  to: string;
  name: string;
}

export function buildPartnerReceivedEmail(data: PartnerReceivedEmailData, from: string): EmailPayload {
  return build(from, data.to, "Pendaftaran mitra SISKOP kami terima", "partner-received", {
    heading: "Pendaftaran mitra diterima",
    greeting: `Halo ${data.name},`,
    paragraphs: [
      "Terima kasih sudah mendaftar sebagai mitra SISKOP. Tim kami akan meninjau pendaftaran Anda dalam 2×24 jam kerja dan mengabari Anda lewat email ini.",
      "Kode referral baru dikirim setelah pendaftaran disetujui."
    ],
    rows: []
  });
}

export interface PartnerApprovedEmailData {
  to: string;
  name: string;
  code: string;
  /** Fraction, e.g. "0.2000". */
  rate: string;
  months: number;
}

/** The share link points at the public register page, so the code is captured even if the visitor never types it. */
export function partnerShareLink(code: string): string {
  const base = (process.env.PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return `${base}/register?ref=${encodeURIComponent(code)}`;
}

export function buildPartnerApprovedEmail(data: PartnerApprovedEmailData, from: string): EmailPayload {
  return build(from, data.to, "Selamat bergabung sebagai mitra SISKOP", "partner-approved", {
    heading: "Pendaftaran mitra disetujui",
    greeting: `Halo ${data.name},`,
    paragraphs: [
      "Pendaftaran Anda sebagai mitra SISKOP disetujui. Bagikan kode atau tautan di bawah ini kepada koperasi yang ingin Anda ajak.",
      `Anda mendapat komisi ${percent(data.rate)} dari tagihan yang dibayar koperasi tersebut selama ${data.months} bulan sejak mereka mendaftar.`
    ],
    rows: [
      ["Kode referral", data.code],
      ["Komisi", percent(data.rate)],
      ["Masa komisi", `${data.months} bulan`],
      ["Tautan pendaftaran", partnerShareLink(data.code)]
    ]
  });
}

export interface PartnerRejectedEmailData {
  to: string;
  name: string;
  reason: string;
}

export function buildPartnerRejectedEmail(data: PartnerRejectedEmailData, from: string): EmailPayload {
  return build(from, data.to, "Pendaftaran mitra SISKOP", "partner-rejected", {
    heading: "Pendaftaran mitra belum dapat disetujui",
    greeting: `Halo ${data.name},`,
    paragraphs: [
      "Terima kasih atas minat Anda. Saat ini pendaftaran mitra Anda belum dapat kami setujui.",
      `Alasan: ${data.reason}`,
      "Anda dapat mendaftar kembali setelah 30 hari."
    ],
    rows: []
  });
}

export const sendPartnerReceivedEmail = (data: PartnerReceivedEmailData) =>
  sendSafely((from) => buildPartnerReceivedEmail(data, from), `partner-received/${data.to}`, "partner-received");
export const sendPartnerApprovedEmail = (data: PartnerApprovedEmailData) =>
  sendSafely((from) => buildPartnerApprovedEmail(data, from), `partner-approved/${data.code}`, data.code);
export const sendPartnerRejectedEmail = (data: PartnerRejectedEmailData & { partnerId: string }) =>
  sendSafely((from) => buildPartnerRejectedEmail(data, from), `partner-rejected/${data.partnerId}`, "partner-rejected");
