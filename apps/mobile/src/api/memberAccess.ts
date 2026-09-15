import type { ApiResponse } from '@siskop/types'
import { ApiRequestError } from './memberClient'

// Selection errors must not clear a separate, already active member session.
export async function memberAccess<T>(step: string, payload: unknown): Promise<T> {
  const response = await fetch(`/api/member-access/${step}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const body = (await response.json()) as ApiResponse<T>
  if (!response.ok || !body.success || body.data === undefined) {
    throw new ApiRequestError(
      body.error?.message ?? 'Tidak dapat masuk. Silakan coba lagi.',
      body.error?.code ?? 'INTERNAL_ERROR',
      response.status
    )
  }
  return body.data
}
export function memberCentralUrl(path = '/anggota/login') {
  return new URL(path, import.meta.env.VITE_PUBLIC_APP_URL || 'https://siskop-d0f8c.web.app').toString()
}
export function memberTenantUrl(value: string, pathname: '/anggota/auth/start' | '/anggota/auth/callback') {
  const url = new URL(value)
  const base = import.meta.env.VITE_TENANT_BASE_DOMAIN || 'koperasi.inovasijayakarsa.id'
  const local = base.endsWith('.localhost')
  const suffix = `.${base}`
  const slug = url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : ''
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ||
    url.protocol !== (local ? 'http:' : 'https:') ||
    url.port !== (local ? window.location.port : '') ||
    url.username ||
    url.password ||
    url.pathname !== pathname
  ) {
    throw new Error('Alamat koperasi tidak valid. Silakan masuk kembali.')
  }
  return url.toString()
}
