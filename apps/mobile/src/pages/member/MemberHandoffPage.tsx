import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberLoginResponse } from '@siskop/types'
import { memberAccess, memberCentralUrl, memberTenantUrl } from '@/api/memberAccess'
import { useMemberAuth } from '@/stores/memberAuth'
import { MemberAuthLayout } from '@/components/layout/MemberAuthLayout'
import { alertClass, outlineButtonClass } from '@/lib/ui'

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
    <MemberAuthLayout title='Membuka portal anggota'>
      {error ? (
        <div className='space-y-4'>
          <p role='alert' className={alertClass}>
            {error}
          </p>
          <a className={outlineButtonClass} href={memberCentralUrl()}>
            Kembali ke halaman masuk
          </a>
        </div>
      ) : (
        <p role='status' className='text-sm text-muted-foreground'>
          Mohon tunggu…
        </p>
      )}
    </MemberAuthLayout>
  )
}
