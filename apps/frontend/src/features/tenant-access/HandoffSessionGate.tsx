import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import type { User } from '@siskop/types'
import { apiFetch, refreshAccessToken } from '@/api/client'
import { useAuth } from '@/stores/auth'

/** A form handoff sets only an HttpOnly cookie. Always restore the actual
 * account before rendering the dashboard, even if another user was cached.
 */
export function HandoffSessionGate() {
  const location = useLocation()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['tenant-handoff-session', location.key],
    queryFn: async () => {
      useAuth.getState().clear()
      const accessToken = await refreshAccessToken()
      const user = await apiFetch<User>('/auth/me')
      return { accessToken, user }
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 0
  })
  useEffect(() => {
    if (!query.data) return
    useAuth.getState().setSession(query.data)
    const search = new URLSearchParams(location.search)
    search.delete('handoff')
    navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }, { replace: true })
  }, [query.data, location.pathname, location.search, location.hash, navigate])
  if (query.isError) return <main className='p-8'>
    <p role='alert'>Sesi masuk belum dapat dibuka. Silakan masuk kembali.</p>
    <a className='underline' href='/login'>Kembali ke halaman masuk</a>
  </main>
  return <p role='status' className='p-8'>Membuka dashboard…</p>
}
