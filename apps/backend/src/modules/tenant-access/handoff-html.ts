import { randomBytes } from 'node:crypto'
import type { Response } from 'express'
import { centralUrl } from './config.js'

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]!))

/** A top-level document, never a frame. Origin is retained for the subsequent
 * cross-site POST; no path or ticket is sent in Referer. No external assets.
 */
export function sendHandoffForm(res: Response, ticket: { action: string; attempt: string; code: string }) {
  const nonce = randomBytes(24).toString('base64')
  res.set({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${new URL(ticket.action).origin}; base-uri 'none'; frame-ancestors 'none'`
  })
  res.type('html').send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="referrer" content="origin"><title>Membuka koperasi</title></head><body>
<form id="handoff" method="post" action="${escape(ticket.action)}" target="_self">
<input type="hidden" name="attempt" value="${escape(ticket.attempt)}">
<input type="hidden" name="code" value="${escape(ticket.code)}">
<noscript><p>Lanjutkan untuk membuka koperasi Anda.</p><button type="submit">Lanjutkan</button></noscript>
</form><script nonce="${nonce}">document.getElementById('handoff').submit()</script></body></html>`)
}

export function sendHandoffError(res: Response, status: number) {
  res.set({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  })
  res.status(status).type('html').send(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Masuk kembali</title></head><body>
<h1>Belum dapat membuka koperasi</h1><p>Tautan masuk tidak berlaku atau akses berubah. Silakan masuk kembali.</p>
<a href="${escape(centralUrl('/login?select=1'))}">Kembali ke halaman masuk</a></body></html>`)
}
