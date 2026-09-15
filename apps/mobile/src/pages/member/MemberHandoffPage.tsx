import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberLoginResponse } from '@siskop/types'
import { memberAccess, memberCentralUrl, memberTenantUrl } from '@/api/memberAccess'
import { useMemberAuth } from '@/stores/memberAuth'

export function MemberHandoffPage({ mode }: { mode: 'start' | 'authorize' | 'callback' }) {
  const started = useRef(false)
  const navigate = useNavigate()
  const [error, setError] = useState('')
  useEffect(() => {
    if (started.current) return
    started.current = true
    const values = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
    const attempt = values.get('attempt'),
      state = values.get('state'),
      code = values.get('code')
    window.history.replaceState(null, '', window.location.pathname)
    void (async () => {
      if (mode === 'start') {
        const data = await memberAccess<{ authorizeUrl: string }>('start', { attempt })
        const target = new URL(data.authorizeUrl)
        if (
          target.origin !== new URL(memberCentralUrl()).origin ||
          target.pathname !== '/anggota/auth/authorize' ||
          target.username ||
          target.password
        ) {
          throw new Error('Alamat masuk tidak valid.')
        }
        window.location.replace(target.toString())
      } else if (mode === 'authorize') {
        const data = await memberAccess<{ callbackUrl: string }>('authorize', { attempt, state })
        window.location.replace(memberTenantUrl(data.callbackUrl, '/anggota/auth/callback'))
      } else {
        const session = await memberAccess<MemberLoginResponse>('redeem', { attempt, state, code })
        useMemberAuth.getState().setSession(session)
        navigate(session.member.mustChangePassword ? '/anggota/ganti-password' : '/anggota/dashboard', {
          replace: true
        })
      }
    })().catch((e) => setError(e instanceof Error ? e.message : 'Tidak dapat masuk. Silakan coba lagi.'))
  }, [mode, navigate])
  return (
    <main className='flex min-h-screen items-center justify-center bg-slate-50 p-6'>
      <div className='w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm'>
        <h1 className='text-xl font-semibold'>Membuka portal anggota</h1>
        {error ? (
          <>
            <p role='alert' className='mt-4 text-sm text-red-700'>
              {error}
            </p>
            <a className='mt-4 block underline' href={memberCentralUrl()}>
              Kembali ke halaman masuk
            </a>
          </>
        ) : (
          <p role='status' className='mt-4 text-sm text-slate-600'>
            Mohon tunggu…
          </p>
        )}
      </div>
    </main>
  )
}
