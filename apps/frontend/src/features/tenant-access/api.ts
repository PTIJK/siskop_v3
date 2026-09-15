import { useQuery } from '@tanstack/react-query'
import type { ApiResponse, TenantAccessConfig } from '@siskop/types'
import { ApiRequestError } from '@/api/client'
export async function accessApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/tenant-access${path}`, {
    credentials: 'same-origin',
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const data = (await response.json()) as ApiResponse<T>
  if (!response.ok || !data.success || data.data === undefined)
    throw new ApiRequestError(
      data.error?.message ?? 'Permintaan gagal',
      data.error?.code ?? 'INTERNAL_ERROR',
      response.status
    )
  return data.data
}
export function useTenantAccessConfig() {
  return useQuery({
    queryKey: ['tenant-access-config'],
    queryFn: () => accessApi<TenantAccessConfig>('/config'),
    staleTime: 60_000,
    retry: 1
  })
}
export function centralLocation(path: string) {
  return new URL(path, import.meta.env.VITE_PUBLIC_APP_URL ?? 'https://siskop-d0f8c.web.app').toString()
}
