import nodemailer, { Transporter } from 'nodemailer';

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

// SMTP is optional for v1 — when unconfigured, emails are logged instead of sent.
export async function sendMail({ to, subject, html }: MailOptions): Promise<void> {
  const client = getTransporter();

  if (!client) {
    console.log(`[Mailer] SMTP not configured, skipping email to ${to}: ${subject}`);
    return;
  }

  await client.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@siskop.com',
    to,
    subject,
    html,
  });
}
