import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { StaffTenantRedirect, TenantMembershipPage } from '@siskop/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { enterTenant } from './enterTenant'
import { apiFetch } from '@/api/client'
import { accessApi, centralLocation } from './api'
export function TenantPickerDialog({
  onCancel,
  currentTenantId,
  beforeSwitch
}: {
  onCancel: () => void
  currentTenantId?: string
  beforeSwitch?: () => boolean
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const query = useQuery({
    queryKey: ['tenant-memberships', currentTenantId, search, page],
    queryFn: () =>
      currentTenantId
        ? apiFetch<TenantMembershipPage>(
            `/tenant-access/switch-memberships?search=${encodeURIComponent(search)}&page=${page}`
          )
        : accessApi<TenantMembershipPage>(`/memberships?search=${encodeURIComponent(search)}&page=${page}`),
    staleTime: 0,
    retry: false
  })
  async function enter() {
    if (!selected || busy) return
    if (selected === currentTenantId) {
      onCancel()
      return
    }
    if (currentTenantId) {
      const item = query.data?.items.find((item) => item.tenantId === selected)
      if (!item || (beforeSwitch && !beforeSwitch())) return
      window.location.assign(
        centralLocation(
          `/login?select=1&tenant=${encodeURIComponent(item.tenantId)}&membership=${encodeURIComponent(item.membershipId)}`
        )
      )
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await accessApi<StaffTenantRedirect>('/select', { tenantId: selected })
      enterTenant(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Belum dapat masuk.')
      setBusy(false)
      void query.refetch()
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent onInteractOutside={(e) => e.preventDefault()} className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Pilih Koperasi</DialogTitle>
          <DialogDescription>
            Pilih koperasi yang ingin Anda buka. Akses mengikuti peran Anda di masing-masing koperasi.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='tenant-search'>Cari koperasi</Label>
          <Input
            id='tenant-search'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
              setSelected('')
            }}
            placeholder='Nama atau alamat koperasi'
          />
        </div>
        {query.isFetching ? (
          <p role='status'>Memuat koperasi…</p>
        ) : query.isError ? (
          <div role='alert'>
            {query.error.message}
            <Button variant='outline' onClick={() => void query.refetch()}>
              Coba lagi
            </Button>
          </div>
        ) : (
          <>
            <RadioGroup
              value={selected}
              onValueChange={setSelected}
              aria-label='Koperasi'
              className='max-h-72 overflow-y-auto'
            >
              {query.data?.items.map((item) => (
                <Label
                  key={item.tenantId}
                  htmlFor={`tenant-${item.tenantId}`}
                  className='flex cursor-pointer items-center gap-3 rounded-md border p-3'
                >
                  <RadioGroupItem id={`tenant-${item.tenantId}`} value={item.tenantId} />
                  <span className='flex min-w-0 flex-col gap-1'>
                    <span>
                      {item.name}
                      {item.tenantId === currentTenantId ? ' · Saat ini' : ''}
                    </span>
                    <span className='truncate text-xs text-muted-foreground'>
                      {item.slug} · {item.roleName}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {query.data?.items.length === 0 ? <p>Tidak ada koperasi yang cocok.</p> : null}
            {(query.data?.filteredTotal ?? 0) > 20 ? (
              <div className='flex items-center justify-between'>
                <Button
                  variant='outline'
                  disabled={page === 1}
                  onClick={() => {
                    setPage((p) => p - 1)
                    setSelected('')
                  }}
                >
                  Sebelumnya
                </Button>
                <span>Halaman {page}</span>
                <Button
                  variant='outline'
                  disabled={page * 20 >= (query.data?.filteredTotal ?? 0)}
                  onClick={() => {
                    setPage((p) => p + 1)
                    setSelected('')
                  }}
                >
                  Berikutnya
                </Button>
              </div>
            ) : null}
          </>
        )}
        {error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant='outline' disabled={busy} onClick={onCancel}>
            Batal
          </Button>
          <Button disabled={!selected || busy || query.isFetching} onClick={() => void enter()}>
            {busy ? 'Membuka…' : 'Masuk'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
