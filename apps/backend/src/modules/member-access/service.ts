import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'
import type { MemberAccessResult } from '@siskop/types'
import { db } from '../../lib/db.js'
import { withoutTenantScope } from '../../lib/tenant-scope.js'
import { forbidden, unauthorized, validationError } from '../../lib/errors.js'
import { centralUrl, tenantOrigin } from '../tenant-access/config.js'
import { memberSessionFor } from '../member-auth/service.js'

export const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
const secret = () => randomBytes(32).toString('base64url')
const future = (ms: number) => new Date(Date.now() + ms)
const include = { member: { include: { tenant: true } }, session: true } as const
const invalid = () => unauthorized('NIK atau kata sandi salah, atau akses anggota belum aktif.')
// A real bcrypt hash ensures absent NIKs also perform password verification.
const dummy = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

export async function login(
  nik: string,
  password: string,
  previous?: string
): Promise<{ token: string; result: MemberAccessResult }> {
  if (previous) await db.memberLoginSession.deleteMany({ where: { tokenHash: digest(previous) } })
  await db.memberLoginSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  // Explicit global discovery exception: exact NIK only; no tenant information
  // leaves this service until that membership's own password is verified.
  const candidates = await withoutTenantScope(() =>
    db.member.findMany({
      where: { nik, isActive: true, passwordHash: { not: null }, tenant: { isActive: true } },
      include: { tenant: true },
      orderBy: { id: 'asc' },
      take: 101
    })
  )
  if (candidates.length > 100) throw validationError('Silakan masuk melalui alamat koperasi Anda.')
  const matches: typeof candidates = []
  if (!candidates.length) await bcrypt.compare(password, dummy)
  for (const member of candidates) {
    if (await bcrypt.compare(password, member.passwordHash!)) matches.push(member)
  }
  if (!matches.length) throw invalid()
  const token = secret()
  const session = await db.memberLoginSession.create({
    data: {
      tokenHash: digest(token),
      expiresAt: future(5 * 60_000),
      grants: { create: matches.map((m) => ({ memberId: m.id, credentialVersion: digest(m.passwordHash!) })) }
    }
  })
  if (matches.length === 1) return { token, result: await select(session.id, matches[0]!.id) }
  return {
    token,
    result: {
      next: 'tenant_selection',
      memberships: matches.map((m) => ({ membershipId: m.id, name: m.tenant.name, slug: m.tenant.slug }))
    }
  }
}

export async function sessionFor(token: string | undefined) {
  if (!token) throw unauthorized('Sesi pemilihan koperasi berakhir. Silakan masuk kembali.')
  const session = await db.memberLoginSession.findUnique({ where: { tokenHash: digest(token) } })
  if (!session || session.expiresAt <= new Date())
    throw unauthorized('Sesi pemilihan koperasi berakhir. Silakan masuk kembali.')
  return session
}
function validateGrant(grant: Prisma.MemberLoginGrantGetPayload<{ include: typeof include }>) {
  if (
    grant.session.expiresAt <= new Date() ||
    !grant.member.isActive ||
    !grant.member.tenant.isActive ||
    !grant.member.passwordHash ||
    digest(grant.member.passwordHash) !== grant.credentialVersion
  )
    throw unauthorized('Akses anggota berubah atau sesi berakhir. Silakan masuk kembali.')
}
export async function select(sessionId: string, membershipId: string): Promise<MemberAccessResult> {
  const grant = await db.memberLoginGrant.findUnique({
    where: { sessionId_memberId: { sessionId, memberId: membershipId } },
    include
  })
  if (!grant) throw unauthorized()
  validateGrant(grant)
  const origin = tenantOrigin(grant.member.tenant.slug)
  const attempt = await db.memberLoginAttempt.create({
    data: { grantId: grant.id, origin, expiresAt: grant.session.expiresAt }
  })
  return { next: 'tenant_redirect', startUrl: `${origin}/anggota/auth/start?attempt=${attempt.id}` }
}
async function attemptFor(id: string, origin?: string) {
  const attempt = await db.memberLoginAttempt.findUnique({ where: { id }, include: { grant: { include } } })
  if (!attempt || attempt.consumedAt || attempt.expiresAt <= new Date())
    throw unauthorized('Tautan masuk berakhir. Silakan masuk kembali.')
  if (origin && attempt.origin !== origin) throw forbidden('Alamat koperasi tidak cocok.')
  validateGrant(attempt.grant)
  if (tenantOrigin(attempt.grant.member.tenant.slug) !== attempt.origin)
    throw unauthorized('Alamat koperasi berubah. Silakan masuk kembali.')
  return attempt
}
export async function start(id: string, origin: string) {
  await attemptFor(id, origin)
  const binding = secret(),
    verifier = secret(),
    state = secret()
  const changed = await db.memberLoginAttempt.updateMany({
    where: { id, bindingHash: null, consumedAt: null },
    data: { bindingHash: digest(binding), challenge: digest(verifier), stateHash: digest(state) }
  })
  if (changed.count !== 1) throw unauthorized('Tautan sudah dibuka. Silakan masuk kembali.')
  return {
    binding: `${binding}.${verifier}`,
    authorizeUrl: centralUrl(`/anggota/auth/authorize#attempt=${id}&state=${state}`)
  }
}
export async function authorize(id: string, state: string, sessionId: string) {
  const attempt = await attemptFor(id)
  if (attempt.grant.sessionId !== sessionId || attempt.stateHash !== digest(state) || !attempt.bindingHash)
    throw unauthorized()
  const code = secret()
  const changed = await db.memberLoginAttempt.updateMany({
    where: { id, codeHash: null, consumedAt: null },
    data: { codeHash: digest(code), codeExpiresAt: future(60_000) }
  })
  if (changed.count !== 1) throw unauthorized('Tautan sudah digunakan. Silakan masuk kembali.')
  return { callbackUrl: `${attempt.origin}/anggota/auth/callback#attempt=${id}&state=${state}&code=${code}` }
}
export async function redeem(
  id: string,
  state: string,
  code: string,
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
  const member = attempt.grant.member
  await db.$transaction(async (tx) => {
    const changed = await tx.memberLoginAttempt.updateMany({
      where: {
        id,
        consumedAt: null,
        codeExpiresAt: { gt: new Date() },
        expiresAt: { gt: new Date() },
        grant: {
          session: { expiresAt: { gt: new Date() } },
          member: {
            isActive: true,
            passwordHash: member.passwordHash,
            tenant: { isActive: true, slug: member.tenant.slug }
          }
        }
      },
      data: { consumedAt: new Date() }
    })
    if (changed.count !== 1) throw unauthorized()
    await tx.member.update({
      where: { id: member.id, tenantId: member.tenantId },
      data: { lastLoginAt: new Date() }
    })
  })
  return memberSessionFor(member)
}
