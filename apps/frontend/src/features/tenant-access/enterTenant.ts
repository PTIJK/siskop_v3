import type { StaffTenantRedirect } from '@siskop/types'
import { canonicalWorkspaceUrl } from '@/features/workspace-domain/host'
import { centralLocation } from './api'

export function enterTenant(result: StaffTenantRedirect) {
  if (!result.handoff) {
    // Compatibility with an older backend during a coordinated rollout.
    window.location.replace(canonicalWorkspaceUrl(result.startUrl))
    return
  }
  if (window.location.origin !== new URL(centralLocation('/')).origin)
    throw new Error('Gunakan halaman masuk pusat.')

  // Some hosts default to no-referrer, which can turn a form POST's Origin
  // into null. The receiver deliberately rejects null. Only send the origin.
  const policy = document.createElement('meta')
  policy.name = 'referrer'
  policy.content = 'origin'
  document.head.append(policy)
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/tenant-access/handoff'
  form.target = '_self'
  form.hidden = true
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'attempt'
  input.value = result.handoff.attempt
  form.append(input)
  document.body.append(form)
  form.submit()
}
