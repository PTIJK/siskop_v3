import { createHash, randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import type { TenantMembershipPage } from '@siskop/types'
import { db } from '../../lib/db.js'
import { withoutTenantScope } from '../../lib/tenant-scope.js'
import { forbidden, unauthorized } from '../../lib/errors.js'
import { getEffectiveUnitIds } from '../../lib/unit-access.js'
import { sessionFor } from '../auth/service.js'
import { assertFirebaseSession, verifyFirebaseIdentity } from '../onboarding/firebase.js'
import { status as orderStatus } from '../onboarding/service.js'
import { centralUrl, tenantOrigin } from './config.js'

export const secretValue = () => randomBytes(32).toString('base64url')
export const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
const future = (ms: number) => new Date(Date.now() + ms)
const include = { role: true, unitAssignments: true, tenant: true } as const

export async function identitySession(token: string | undefined) {
  if (!token) throw unauthorized()
  const session = await db.identitySession.findUnique({
    where: { tokenHash: digest(token) },
    include: { identity: true }
  })
  return validateIdentitySession(session)
}
async function validateIdentitySession(
  session: Prisma.IdentitySessionGetPayload<{ include: { identity: true } }> | null
) {
  if (
    !session ||
    !session.identity.isActive ||
    session.expiresAt <= new Date() ||
    session.lastSeenAt.getTime() < Date.now() - 30 * 60_000
  )
    throw unauthorized('Sesi pemilihan koperasi berakhir. Silakan masuk kembali.')
  await assertFirebaseSession(session.identity.firebaseUid, session.authTime)
  await db.identitySession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
  return session
}
function eligibleWhere(identityId: string): Prisma.UserWhereInput {
  return {
    identityId,
    identity: { isActive: true },
    isActive: true,
    isPlatformAdmin: false,
    tenant: { isActive: true },
    // Match getEffectiveUnitIds: explicit assignments, otherwise active tenant units.
    OR: [
      { unitAssignments: { some: {} } },
      { unitAssignments: { none: {} }, tenant: { units: { some: { isActive: true } } } }
    ]
  }
}
export async function memberships(identityId: string, search = '', page = 1): Promise<TenantMembershipPage> {
  const eligible = eligibleWhere(identityId)
  const filtered: Prisma.UserWhereInput = {
    AND: [
      eligible,
      ...(search
        ? [
            {
              tenant: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { slug: { contains: search, mode: 'insensitive' as const } }
                ]
              }
            }
          ]
        : [])
    ]
  }
  // Global discovery is constrained to the verified identity; SQL paginates before loading rows.
  return withoutTenantScope(() =>
    db.$transaction(
      async (tx) => {
        const total = await tx.user.count({ where: eligible })
        const filteredTotal = search ? await tx.user.count({ where: filtered }) : total
        const users = await tx.user.findMany({
          where: filtered,
          include: { tenant: true, role: true },
          orderBy: [{ tenant: { name: 'asc' } }, { id: 'asc' }],
          skip: (page - 1) * 20,
          take: 20
        })
        return {
          total,
          filteredTotal,
          page,
          items: users.map((u) => ({
            tenantId: u.tenantId,
            membershipId: u.id,
            name: u.tenant.name,
            slug: u.tenant.slug,
            logoUrl: u.tenant.logoUrl,
            roleName: u.role.name
          }))
        }
      },
      { isolationLevel: 'RepeatableRead' }
    )
  )
}
export async function selectTenant(
  session: Awaited<ReturnType<typeof identitySession>>,
  tenantId: string,
  expectedMembershipId?: string
) {
  const user = await withoutTenantScope(() =>
    db.user.findFirst({ where: { AND: [eligibleWhere(session.identityId), { tenantId }] }, include })
  )
  if (!user || (expectedMembershipId && user.id !== expectedMembershipId))
    throw forbidden('Akun ini tidak cocok dengan akses yang dipilih. Masuk dengan akun yang membuka pemilih koperasi.')
  const attempt = await db.tenantLoginAttempt.create({
    data: {
      identitySessionId: session.id,
      membershipId: user.id,
      origin: tenantOrigin(user.tenant.slug),
      expiresAt: future(5 * 60_000)
    }
  })
  return { next: 'tenant_redirect' as const, startUrl: `${attempt.origin}/auth/start?attempt=${attempt.id}` }
}
export async function login(idToken: string) {
  const proof = await verifyFirebaseIdentity(idToken)
  const identity = await db.accountIdentity.findUnique({ where: { firebaseUid: proof.uid } })
  if (!identity) return { result: { next: 'no_access' as const } }
  if (!identity.isActive) throw unauthorized('Akun tidak aktif.')
  const platform = await withoutTenantScope(() =>
    db.user.findFirst({ where: { identityId: identity.id, isActive: true, isPlatformAdmin: true }, include })
  )
  if (platform) return { result: { next: 'dashboard' as const, session: await sessionFor(platform, proof.authTime) } }
  await db.identitySession.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { lastSeenAt: { lt: new Date(Date.now() - 30 * 60_000) } }] }
  })
  await db.tenantLoginAttempt.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  const token = secretValue()
  const session = await db.identitySession.create({
    data: {
      tokenHash: digest(token),
      identityId: identity.id,
      authTime: Math.floor(proof.authTime),
      expiresAt: future(8 * 60 * 60_000)
    },
    include: { identity: true }
  })
  const available = await memberships(identity.id)
  if (available.total === 1) return { token, result: await selectTenant(session, available.items[0]!.tenantId) }
  if (available.total > 1)
    return { token, result: { next: 'tenant_selection' as const, eligibleCount: available.total } }
  const pending = await withoutTenantScope(() =>
    db.user.findFirst({
      where: { identityId: identity.id, isActive: true, tenant: { onboardingOrder: { status: 'PENDING' } } },
      include: { tenant: { include: { onboardingOrder: true } } }
    })
  )
  const order = pending?.tenant.onboardingOrder
  if (order?.adminId === pending?.id && order)
    return { token, result: { next: 'checkout' as const, order: await orderStatus(order.id) } }
  return { token, result: { next: 'no_access' as const } }
}
async function attemptFor(id: string, origin?: string) {
  const attempt = await db.tenantLoginAttempt.findUnique({
    where: { id },
    include: { membership: { include }, identitySession: { include: { identity: true } } }
  })
  if (!attempt || attempt.consumedAt || attempt.expiresAt <= new Date())
    throw unauthorized('Tautan masuk kedaluwarsa. Silakan ulangi.')
  if (origin && origin !== attempt.origin) throw forbidden('Alamat koperasi tidak cocok.')
  const u = attempt.membership
  if (
    !u.isActive ||
    !u.tenant.isActive ||
    u.isPlatformAdmin ||
    u.identityId !== attempt.identitySession.identityId ||
    tenantOrigin(u.tenant.slug) !== attempt.origin ||
    !(await getEffectiveUnitIds(u.id, u.tenantId)).length
  )
    throw forbidden('Akses atau alamat koperasi berubah. Silakan masuk kembali.')
  await validateIdentitySession(attempt.identitySession)
  return attempt
}
export async function startAttempt(id: string, origin: string) {
  await attemptFor(id, origin)
  const binding = secretValue(),
    verifier = secretValue(),
    state = secretValue()
  const changed = await db.tenantLoginAttempt.updateMany({
    where: { id, bindingHash: null, consumedAt: null },
    data: { bindingHash: digest(binding), challenge: digest(verifier), stateHash: digest(state) }
  })
  if (changed.count !== 1) throw unauthorized('Tautan sudah dibuka. Silakan ulangi proses masuk.')
  return { binding: `${binding}.${verifier}`, authorizeUrl: centralUrl(`/auth/authorize#attempt=${id}&state=${state}`) }
}
export async function authorizeAttempt(
  id: string,
  state: string,
  session: Awaited<ReturnType<typeof identitySession>>
) {
  const attempt = await attemptFor(id)
  if (session.id !== attempt.identitySessionId || attempt.stateHash !== digest(state) || !attempt.bindingHash)
    throw unauthorized()
  const code = secretValue()
  const changed = await db.tenantLoginAttempt.updateMany({
    where: { id, codeHash: null, consumedAt: null },
    data: { codeHash: digest(code), codeExpiresAt: future(60_000) }
  })
  if (changed.count !== 1) throw unauthorized('Tautan sudah digunakan. Silakan ulangi.')
  return { callbackUrl: `${attempt.origin}/auth/callback#attempt=${id}&state=${state}&code=${code}` }
}
export async function redeemAttempt(
  id: string,
  code: string,
  state: string,
  cookie: string | undefined,
  origin: string
) {
  const attempt = await attemptFor(id, origin)
  const [binding, verifier] = (cookie ?? '').split('.')
  if (
    !binding ||
    !verifier ||
    digest(binding) !== attempt.bindingHash ||
    digest(verifier) !== attempt.challenge ||
    digest(state) !== attempt.stateHash ||
    digest(code) !== attempt.codeHash ||
    !attempt.codeExpiresAt ||
    attempt.codeExpiresAt <= new Date()
  )
    throw unauthorized()
  // Derive permissions before consuming; the transactional conditional update allows one winner.
  const session = await sessionFor(attempt.membership, attempt.identitySession.authTime)
  await db.$transaction(async (tx) => {
    const changed = await tx.tenantLoginAttempt.updateMany({
      where: {
        id,
        consumedAt: null,
        codeExpiresAt: { gt: new Date() },
        expiresAt: { gt: new Date() },
        membership: {
          isActive: true,
          identityId: attempt.identitySession.identityId,
          tenant: { isActive: true, slug: attempt.membership.tenant.slug }
        }
      },
      data: { consumedAt: new Date() }
    })
    if (changed.count !== 1) throw unauthorized()
    await tx.user.update({
      where: { id: attempt.membershipId, tenantId: attempt.membership.tenantId },
      data: { lastLoginAt: new Date() }
    })
  })
  return session
}
export async function logout(token: string | undefined) {
  if (token) await db.identitySession.deleteMany({ where: { tokenHash: digest(token) } })
}
