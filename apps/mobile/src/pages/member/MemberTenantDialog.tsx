import { useEffect, useId, useRef } from 'react'
import type { MemberLoginMembership } from '@siskop/types'
import { alertClass, outlineButtonClass } from '@/lib/ui'

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
      className='m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-sm rounded-[20px] border bg-card p-6 text-card-foreground shadow-xl backdrop:bg-foreground/40'
    >
      <h2 id={title} className='text-lg font-extrabold tracking-tight'>
        Pilih koperasi
      </h2>
      <p id={description} className='mt-2 text-sm text-muted-foreground'>
        Akun Anda cocok dengan beberapa koperasi. Pilih portal yang ingin dibuka.
      </p>
      <ul className='mt-4 space-y-2'>
        {memberships.map((m) => (
          <li key={m.membershipId}>
            <button
              type='button'
              disabled={pending}
              onClick={() => onSelect(m.membershipId)}
              className='min-h-[56px] w-full rounded-[12px] border bg-card px-4 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45'
            >
              <span className='block font-bold'>{m.name}</span>
              <span className='block text-sm text-muted-foreground'>{m.slug}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role='alert' className={`${alertClass} mt-4`}>
          {error}
        </p>
      )}
      <button type='button' disabled={pending} onClick={onClose} className={`${outlineButtonClass} mt-5`}>
        Kembali
      </button>
    </dialog>
  )
}
