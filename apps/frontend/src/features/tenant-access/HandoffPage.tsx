import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LoginResponse } from '@siskop/types'
import { useAuth } from '@/stores/auth'
import { canonicalWorkspaceUrl } from '@/features/workspace-domain/host'
import { accessApi, centralLocation } from './api'

/** No marketing shell or third-party assets on code-exchange pages. */
export default function HandoffPage({ mode }: { mode: 'start' | 'authorize' | 'callback' | 'logout' }) {
  const run = useRef(false)
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    if (run.current) return
    run.current = true
    const values = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
    const attempt = values.get('attempt'),
      state = values.get('state'),
      code = values.get('code')
    window.history.replaceState(null, '', window.location.pathname)
    void (async () => {
      if (mode === 'start') {
        const data = await accessApi<{ authorizeUrl: string }>('/start', { attempt })
        if (new URL(data.authorizeUrl).origin !== new URL(centralLocation('/')).origin)
          throw new Error('Alamat masuk tidak valid.')
        window.location.replace(data.authorizeUrl)
      } else if (mode === 'authorize') {
        const data = await accessApi<{ callbackUrl: string }>('/authorize', { attempt, state })
        window.location.replace(canonicalWorkspaceUrl(data.callbackUrl))
      } else if (mode === 'callback') {
        const session = await accessApi<LoginResponse>('/redeem', { attempt, state, code })
        useAuth.getState().setSession(session)
        navigate('/dashboard', { replace: true })
      } else {
        await accessApi('/logout', {})
        useAuth.getState().clear()
        navigate('/login', { replace: true })
      }
    })().catch((e) => setError(e instanceof Error ? e.message : 'Belum dapat masuk.'))
  }, [mode, navigate])
  return (
    <main className='mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6'>
      <h1 className='text-xl font-semibold'>{mode === 'logout' ? 'Keluar' : 'Membuka koperasi'}</h1>
      {error ? (
        <>
          <p role='alert'>{error}</p>
          <a className='underline' href={centralLocation('/login?select=1')}>
            Kembali ke halaman masuk
          </a>
        </>
      ) : (
        <p role='status'>Mohon tunggu…</p>
      )}
    </main>
  )
}
