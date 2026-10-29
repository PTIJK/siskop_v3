import { PasswordInput } from '@/components/shared/PasswordInput'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  ApiResponse,
  MemberAccessResult,
  MemberLoginMembership,
  MemberLoginResponse,
  WorkspaceContext
} from '@siskop/types'
import { memberApiPost, ApiRequestError } from '@/api/memberClient'
import { useMemberAuth } from '@/stores/memberAuth'

import { memberAccess, memberTenantUrl } from '@/api/memberAccess'
import { MemberAuthLayout } from '@/components/layout/MemberAuthLayout'
import { alertClass, inputClass, labelClass, outlineButtonClass, primaryButtonClass } from '@/lib/ui'
import { MemberTenantDialog } from './MemberTenantDialog'

export default function MemberLoginPage() {
  const navigate = useNavigate()
  const setSession = useMemberAuth((s) => s.setSession)

  const [nik, setNik] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(true)
  const [workspaceError, setWorkspaceError] = useState('')
  const [memberships, setMemberships] = useState<MemberLoginMembership[]>([])
  useEffect(() => {
    let active = true
    void fetch('/api/workspace', { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json()) as ApiResponse<WorkspaceContext | null>
        if (!res.ok || !body.success) throw new Error(body.error?.message ?? 'Koperasi tidak tersedia.')
        if (body.data?.isAlias) {
          const target = new URL(body.data.canonicalLoginUrl)
          const base = import.meta.env.VITE_TENANT_BASE_DOMAIN || 'koperasi.inovasijayakarsa.id'
          if (
            !target.hostname.endsWith(`.${base}`) ||
            !['https:', ...(import.meta.env.DEV ? ['http:'] : [])].includes(target.protocol)
          )
            throw new Error('Alamat koperasi tidak valid.')
          target.pathname = '/anggota/login'
          target.search = ''
          target.hash = ''
          window.location.replace(target.toString())
          return
        }
        if (active) setWorkspace(body.data ?? null)
      })
      .catch((err) => {
        if (active) setWorkspaceError(err instanceof Error ? err.message : 'Koneksi gagal.')
      })
      .finally(() => {
        if (active) setLoadingWorkspace(false)
      })
    return () => {
      active = false
    }
  }, [])

  function acceptResult(result: MemberAccessResult) {
    setPassword('')
    if (result.next === 'tenant_redirect') {
      window.location.assign(memberTenantUrl(result.startUrl, '/anggota/auth/start'))
    } else setMemberships(result.memberships)
  }

  async function selectMembership(membershipId: string) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      acceptResult(await memberAccess<MemberAccessResult>('select', { membershipId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tidak dapat masuk. Silakan coba lagi.')
    } finally {
      setPending(false)
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (loadingWorkspace || workspaceError || pending) return
    setError(null)
    setPending(true)

    try {
      if (!workspace) {
        acceptResult(await memberAccess<MemberAccessResult>('login', { nik: nik.trim(), password }))
        return
      }
      const session = await memberApiPost<MemberLoginResponse>('/member-auth/login', { nik, password })
      setSession(session)
      navigate(session.member.mustChangePassword ? '/anggota/ganti-password' : '/anggota/dashboard', {
        replace: true
      })
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Tidak dapat terhubung ke server')
    } finally {
      setPending(false)
    }
  }

  const footer = (
    <>
      Petugas koperasi?{' '}
      <a href='/login' className='font-bold text-foreground underline underline-offset-2'>
        Masuk di sini
      </a>
    </>
  )

  return (
    <MemberAuthLayout
      title='Masuk Anggota'
      footer={footer}
      description={
        workspace ? (
          <>
            Koperasi: <span className='font-bold text-foreground'>{workspace.name}</span>
          </>
        ) : (
          'Masukkan NIK dan kata sandi untuk membuka koperasi Anda.'
        )
      }
    >
      {loadingWorkspace ? (
        <p role='status' className='text-sm text-muted-foreground'>
          Memuat koperasi…
        </p>
      ) : workspaceError ? (
        <div role='alert' className='space-y-3'>
          <p className={alertClass}>{workspaceError}</p>
          <button type='button' className={outlineButtonClass} onClick={() => window.location.reload()}>
            Coba lagi
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <label className={labelClass} htmlFor='nik'>
            NIK
          </label>
          <input
            id='nik'
            type='text'
            inputMode='numeric'
            pattern='[0-9]{16}'
            maxLength={16}
            disabled={pending}
            required
            autoComplete='username'
            value={nik}
            onChange={(e) => setNik(e.target.value)}
            className={inputClass}
          />

          <label className={`${labelClass} mt-4`} htmlFor='password'>
            Kata sandi
          </label>
          <PasswordInput
            id='password'
            disabled={pending}
            required
            autoComplete='current-password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <p className='mt-1.5 text-xs text-muted-foreground'>
            Kata sandi awal adalah tanggal lahir Anda (format DDMMYYYY), diaktifkan oleh petugas koperasi.
          </p>

          {error && memberships.length === 0 && (
            <p role='alert' className={`${alertClass} mt-4`}>
              {error}
            </p>
          )}

          <button type='submit' disabled={pending} className={`${primaryButtonClass} mt-6`}>
            {pending ? 'Memproses…' : 'Masuk'}
          </button>
        </form>
      )}

      {memberships.length > 0 && (
        <MemberTenantDialog
          memberships={memberships}
          pending={pending}
          error={error}
          onSelect={selectMembership}
          onClose={() => {
            setMemberships([])
            setError(null)
          }}
        />
      )}
    </MemberAuthLayout>
  )
}
