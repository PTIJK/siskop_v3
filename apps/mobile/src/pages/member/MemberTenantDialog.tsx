import { useEffect, useId, useRef } from 'react'
import type { MemberLoginMembership } from '@siskop/types'

export function MemberTenantDialog({
  memberships,
  pending,
  error,
  onSelect,
  onClose
}: {
  memberships: MemberLoginMembership[]
  pending: boolean
  error: string | null
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId(),
    description = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
      className='m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-900/40'
    >
      <h2 id={title} className='text-lg font-semibold text-slate-900'>
        Pilih koperasi
      </h2>
      <p id={description} className='mt-2 text-sm text-slate-600'>
        Akun Anda cocok dengan beberapa koperasi. Pilih portal yang ingin dibuka.
      </p>
      <ul className='mt-4 space-y-2'>
        {memberships.map((m) => (
          <li key={m.membershipId}>
            <button
              type='button'
              disabled={pending}
              onClick={() => onSelect(m.membershipId)}
              className='w-full rounded-lg border border-slate-200 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50'
            >
              <span className='block font-medium text-slate-900'>{m.name}</span>
              <span className='block text-sm text-slate-500'>{m.slug}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role='alert' className='mt-4 text-sm text-red-700'>
          {error}
        </p>
      )}
      <button
        type='button'
        disabled={pending}
        onClick={onClose}
        className='mt-5 w-full rounded-md border px-4 py-2 text-sm disabled:opacity-50'
      >
        Kembali
      </button>
    </dialog>
  )
}
