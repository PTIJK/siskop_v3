import express from 'express'
import { firebaseHosting } from '../src/hosting/firebase.js'
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { db } from '../src/lib/db.js'
import { inviteMembership, acceptInvitation } from '../src/modules/tenant-access/invitations.js'
import { verifyFirebaseIdentity } from '../src/modules/onboarding/firebase.js'
import { registerTenant } from '../src/modules/auth/service.js'

vi.mock('../src/modules/onboarding/firebase.js', () => ({
  verifyFirebaseIdentity: vi.fn(async (uid: string) => ({
    uid,
    email: 'person@test.example',
    provider: 'google.com',
    authTime: Math.floor(Date.now() / 1000),
    emailVerified: true
  })),
  assertFirebaseSession: vi.fn(async () => {})
}))
const base = 'koperasi.inovasijayakarsa.id'
const key = 'test-tenant-access-gateway-secret-32-characters'
const central = 'https://siskop-d0f8c.web.app'
const app = createApp()
function signed(method: string, path: string, slug = 'alpha') {
  const host = `${slug}.${base}`,
    time = String(Date.now())
  return {
    'x-siskop-host': host,
    'x-siskop-time': time,
    'x-siskop-signature': createHmac('sha256', key).update([time, method, path, host].join('\n')).digest('base64url'),
    Origin: `https://${host}`
  }
}
const cookie = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ')
const register = (slug: string) =>
  registerTenant({
    tenantName: slug,
    slug,
    registrationNo: slug,
    address: 'Jakarta',
    type: 'KONVENSIONAL',
    adminName: 'Staff',
    adminEmail: `${slug}@test.example`,
    password: 'Test-only-123',
    firstUnit: { type: 'KSP', name: 'Simpan pinjam' }
  })
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/missing').pathname.endsWith('_test'))
    throw new Error('Use an isolated _test database.')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('JWT_SECRET', 'test-secret')
  vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh')
  vi.stubEnv('TENANT_BASE_DOMAIN', base)
  vi.stubEnv('TENANT_DOMAINS_ENABLED', 'true')
  vi.stubEnv('TENANT_LOGIN_SELECTION_ENABLED', 'true')
  vi.stubEnv('TENANT_SWITCHING_ENABLED', 'true')
  vi.stubEnv('TENANT_GATEWAY_SECRET', key)
  vi.stubEnv('PUBLIC_APP_URL', central)
  await db.tenant.deleteMany({})
  await db.accountIdentity.deleteMany({})
})
afterEach(() => vi.unstubAllEnvs())
async function fixtures(multi = false) {
  const a = await register('alpha')
  const b = await register('beta')
  const identity = await db.accountIdentity.create({ data: { firebaseUid: 'person-uid' } })
  await db.user.update({
    where: { id: a.user.id, tenantId: a.user.tenantId },
    data: { identityId: identity.id, firebaseUid: 'person-uid' }
  })
  if (multi)
    await db.user.update({ where: { id: b.user.id, tenantId: b.user.tenantId }, data: { identityId: identity.id } })
  return { a, b, identity }
}
async function login() {
  return request(app).post('/api/tenant-access/login').set('Origin', central).send({ idToken: 'person-uid' })
}
async function prepare() {
  const f = await fixtures()
  const response = await login()
  expect(response.status).toBe(200)
  const attempt = new URL(response.body.data.startUrl).searchParams.get('attempt')
  const path = '/api/tenant-access/start'
  const started = await request(app).post(path).set(signed('POST', path)).send({ attempt })
  expect(started.status).toBe(200)
  const state = new URLSearchParams(new URL(started.body.data.authorizeUrl).hash.slice(1)).get('state')
  const auth = await request(app)
    .post('/api/tenant-access/authorize')
    .set('Origin', central)
    .set('Cookie', cookie(response))
    .send({ attempt, state })
  expect(auth.status).toBe(200)
  const code = new URLSearchParams(new URL(auth.body.data.callbackUrl).hash.slice(1)).get('code')
  return { ...f, attempt, state, code, binding: cookie(started) }
}
describe('tenant selection and browser-bound handoff', () => {
  it('auto-selects one membership without issuing a central tenant session', async () => {
    await fixtures()
    const res = await login()
    expect(res.status).toBe(200)
    expect(res.body.data.next).toBe('tenant_redirect')
    expect(new URL(res.body.data.startUrl).host).toBe(`alpha.${base}`)
    expect(res.body.data.session).toBeUndefined()
    expect(cookie(res)).not.toMatch(/siskop_refresh_token=[^;]/)
  })
  it('lists only eligible memberships and rejects an unowned selection', async () => {
    const { b } = await fixtures()
    const res = await login()
    const memberships = await request(app).get('/api/tenant-access/memberships').set('Cookie', cookie(res))
    expect(memberships.body.data.total).toBe(1)
    const rejected = await request(app)
      .post('/api/tenant-access/select')
      .set('Origin', central)
      .set('Cookie', cookie(res))
      .send({ tenantId: b.user.tenantId })
    expect(rejected.status).toBe(403)
  })
  it('requires selection for multiple memberships and supports search', async () => {
    await fixtures(true)
    const res = await login()
    expect(res.body.data.next).toBe('tenant_selection')
    const list = await request(app).get('/api/tenant-access/memberships?search=beta').set('Cookie', cookie(res))
    expect(list.body.data.total).toBe(2)
    expect(list.body.data.items.map((m: { slug: string }) => m.slug)).toEqual(['beta'])
  })
  it('redeems once on the right host and rejects another browser and tenant', async () => {
    const p = await prepare()
    const path = '/api/tenant-access/redeem'
    const body = { attempt: p.attempt, code: p.code, state: p.state }
    expect((await request(app).post(path).set(signed('POST', path)).send(body)).status).toBe(401)
    expect(
      (
        await request(app)
          .post(path)
          .set(signed('POST', path, 'beta'))
          .set('Cookie', p.binding)
          .send(body)
      ).status
    ).toBe(403)
    const results = await Promise.all(
      [1, 2].map(() => request(app).post(path).set(signed('POST', path)).set('Cookie', p.binding).send(body))
    )
    expect(results.map((r) => r.status).sort()).toEqual([200, 401])
    expect(results.find((r) => r.status === 200)?.body.data.user.tenantId).toBe(p.a.user.tenantId)
  })
  it('rechecks revoked membership before issuing a destination session', async () => {
    const p = await prepare()
    await db.user.update({ where: { id: p.a.user.id, tenantId: p.a.user.tenantId }, data: { isActive: false } })
    const path = '/api/tenant-access/redeem'
    expect(
      (
        await request(app)
          .post(path)
          .set(signed('POST', path))
          .set('Cookie', p.binding)
          .send({ attempt: p.attempt, code: p.code, state: p.state })
      ).status
    ).toBe(403)
  })
  it('rejects expired codes and cross-origin selection', async () => {
    const p = await prepare()
    await db.tenantLoginAttempt.update({ where: { id: p.attempt! }, data: { codeExpiresAt: new Date(0) } })
    const path = '/api/tenant-access/redeem'
    expect(
      (
        await request(app)
          .post(path)
          .set(signed('POST', path))
          .set('Cookie', p.binding)
          .send({ attempt: p.attempt, code: p.code, state: p.state })
      ).status
    ).toBe(401)
    expect(
      (
        await request(app)
          .post('/api/tenant-access/select')
          .set('Origin', 'https://evil.example')
          .send({ tenantId: p.a.user.tenantId })
      ).status
    ).toBe(403)
  })
  it('links a verified invitation as a second membership and rejects replay', async () => {
    const { b } = await fixtures()
    await db.user.update({
      where: { id: b.user.id, tenantId: b.user.tenantId },
      data: { email: 'person@test.example' }
    })
    const invitation = await inviteMembership(b.user.tenantId, b.user.id)
    const token = new URLSearchParams(new URL(invitation.invitationUrl).hash.slice(1)).get('token')!
    await acceptInvitation(token, 'person-uid')
    expect((await login()).body.data.next).toBe('tenant_selection')
    const linked = await db.user.findUniqueOrThrow({ where: { id: b.user.id, tenantId: b.user.tenantId } })
    expect(linked.roleId).toBe(b.user.roleId)
    expect(linked.passwordHash).toBeNull()
    await expect(acceptInvitation(token, 'person-uid')).rejects.toThrow('Undangan tidak valid')
  })
  it('rejects wrong-recipient, unverified, and expired invitations without linking', async () => {
    const { b } = await fixtures()
    const invitation = await inviteMembership(b.user.tenantId, b.user.id)
    const token = new URLSearchParams(new URL(invitation.invitationUrl).hash.slice(1)).get('token')!
    await expect(acceptInvitation(token, 'person-uid')).rejects.toThrow('bukan untuk akun')
    vi.mocked(verifyFirebaseIdentity).mockResolvedValueOnce({
      uid: 'person-uid',
      email: 'person@test.example',
      emailVerified: false,
      provider: 'password',
      authTime: 1
    })
    await expect(acceptInvitation(token, 'person-uid')).rejects.toThrow('Verifikasi')
    await db.membershipInvitation.updateMany({ data: { expiresAt: new Date(0) } })
    await expect(acceptInvitation(token, 'person-uid')).rejects.toThrow('kedaluwarsa')
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: b.user.id, tenantId: b.user.tenantId } })).identityId
    ).toBeNull()
  })
  it('expires idle identity sessions and removes attempts on logout', async () => {
    await fixtures()
    const res = await login()
    await db.identitySession.updateMany({ data: { lastSeenAt: new Date(0) } })
    expect((await request(app).get('/api/tenant-access/memberships').set('Cookie', cookie(res))).status).toBe(401)
    const next = await login()
    expect(await db.tenantLoginAttempt.count()).toBe(1)
    await request(app)
      .post('/api/tenant-access/logout')
      .set('Origin', central)
      .set('Cookie', cookie(next))
      .send({})
      .expect(200)
    expect(await db.tenantLoginAttempt.count()).toBe(0)
    expect((await request(app).get('/api/tenant-access/memberships').set('Cookie', cookie(next))).status).toBe(401)
  })
  it('does not count inactive or unusable memberships and handles unknown identities', async () => {
    const { b, a } = await fixtures(true)
    await db.tenant.update({ where: { id: b.user.tenantId }, data: { isActive: false } })
    expect((await login()).body.data.next).toBe('tenant_redirect')
    await db.cooperativeUnit.updateMany({ where: { tenantId: a.user.tenantId }, data: { isActive: false } })
    expect((await login()).body.data.next).toBe('no_access')
    const unknown = await request(app)
      .post('/api/tenant-access/login')
      .set('Origin', central)
      .send({ idToken: 'unknown' })
    expect(unknown.body.data.next).toBe('no_access')
    expect(await db.accountIdentity.count()).toBe(1)
  })
  it('rejects renamed destinations, wrong state, and wrong PKCE verifier', async () => {
    const p = await prepare()
    const path = '/api/tenant-access/redeem'
    const body = { attempt: p.attempt, code: p.code, state: p.state }
    expect(
      (
        await request(app)
          .post(path)
          .set(signed('POST', path))
          .set('Cookie', p.binding)
          .send({ ...body, state: 'x'.repeat(43) })
      ).status
    ).toBe(401)
    const broken = p.binding.replace(/\.[^.;]+$/, '.' + 'x'.repeat(43))
    expect((await request(app).post(path).set(signed('POST', path)).set('Cookie', broken).send(body)).status).toBe(401)
    await db.tenant.update({ where: { id: p.a.user.tenantId }, data: { slug: 'renamed-alpha' } })
    expect(
      (
        await request(app)
          .post(path)
          .set(signed('POST', path, 'renamed-alpha'))
          .set('Cookie', p.binding)
          .send(body)
      ).status
    ).toBe(403)
  })
  it('keeps the platform central session and rejects cooperative central refresh', async () => {
    const { a } = await fixtures()
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `siskop_refresh_token=${a.refreshToken}`)
      .send({})
    expect(refresh.status).toBe(401)
    await db.user.update({ where: { id: a.user.id, tenantId: a.user.tenantId }, data: { isPlatformAdmin: true } })
    const res = await login()
    expect(res.body.data.next).toBe('dashboard')
    expect(res.body.data.session.user.isPlatformAdmin).toBe(true)
  })
  it('discovers switch choices only for the current staff identity', async () => {
    const { a } = await fixtures(true)
    const path = '/api/tenant-access/switch-memberships?search=beta'
    const res = await request(app).get(path).set(signed('GET', path)).set('Authorization', `Bearer ${a.accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.items.map((m: { slug: string }) => m.slug)).toEqual(['beta'])
    expect(
      (
        await request(app)
          .get(path)
          .set(signed('GET', path, 'beta'))
          .set('Authorization', `Bearer ${a.accessToken}`)
      ).status
    ).toBe(403)
  })

  it('transports central identity cookies through Firebase Hosting and regular cookies through signed tenant requests', async () => {
    await fixtures()
    const hosted = express().use(firebaseHosting(), createApp())
    const res = await request(hosted)
      .post('/api/tenant-access/login')
      .set('Origin', central)
      .send({ idToken: 'person-uid' })
    expect(res.status).toBe(200)
    const identityCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.includes('Path=/api/tenant-access')
    )!
    expect(identityCookie).toMatch(/^__session=/)
    expect(identityCookie).toContain('HttpOnly; Secure; SameSite=Lax')
    const list = await request(hosted)
      .get('/api/tenant-access/memberships')
      .set('Cookie', identityCookie.split(';')[0]!)
    expect(list.body.data.total).toBe(1)
    const attempt = new URL(res.body.data.startUrl).searchParams.get('attempt')
    const path = '/api/tenant-access/start'
    const started = await request(hosted).post(path).set(signed('POST', path)).send({ attempt })
    expect(cookie(started)).toContain(`siskop_handoff_${attempt}=`)
    expect(cookie(started)).not.toContain('__session=')
  })
  it('preserves direct login for linked memberships while rejecting another workspace', async () => {
    await fixtures(true)
    const path = '/api/onboarding/login'
    const direct = await request(app)
      .post(path)
      .set(signed('POST', path, 'beta'))
      .send({ idToken: 'person-uid' })
    expect(direct.status).toBe(200)
    expect(direct.body.data.session.user.email).toBe('beta@test.example')
    await register('gamma')
    expect(
      (
        await request(app)
          .post(path)
          .set(signed('POST', path, 'gamma'))
          .send({ idToken: 'person-uid' })
      ).status
    ).toBe(401)
    expect((await request(app).post(path).set('Origin', central).send({ idToken: 'person-uid' })).status).toBe(403)
  })
  it('rejects switching a membership belonging to a different signed-in identity', async () => {
    const { a, b } = await fixtures(true)
    const res = await login()
    const selected = await request(app)
      .post('/api/tenant-access/select')
      .set('Origin', central)
      .set('Cookie', cookie(res))
      .send({ tenantId: b.user.tenantId, membershipId: a.user.id })
    expect(selected.status).toBe(403)
  })

  it('keeps an authoritative total when memberships span multiple pages', async () => {
    const { identity } = await fixtures()
    for (let i = 0; i < 20; i++) {
      const added = await register(`page-${String(i).padStart(2, '0')}`)
      await db.user.update({
        where: { id: added.user.id, tenantId: added.user.tenantId },
        data: { identityId: identity.id }
      })
    }
    const res = await login()
    expect(res.body.data.eligibleCount).toBe(21)
    const page = await request(app).get('/api/tenant-access/memberships?page=2').set('Cookie', cookie(res))
    expect(page.body.data.total).toBe(21)
    expect(page.body.data.items).toHaveLength(1)
    const search = await request(app).get('/api/tenant-access/memberships?search=page-19').set('Cookie', cookie(res))
    expect(search.body.data.total).toBe(21)
    expect(search.body.data.filteredTotal).toBe(1)
  })
  it("creates invited staff within the administrator's role and unit scope", async () => {
    const { a, b } = await fixtures()
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: a.user.tenantId } })
    const path = '/api/users/invitations'
    const body = { name: 'Invited', email: 'new@test.example', roleId: a.user.roleId, unitIds: [unit.id] }
    const res = await request(app)
      .post(path)
      .set(signed('POST', path))
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send(body)
    expect(res.status).toBe(201)
    expect(res.body.data.invitationUrl).toContain('/invite#token=')
    const added = await db.user.findUniqueOrThrow({
      where: { tenantId_email: { tenantId: a.user.tenantId, email: body.email } }
    })
    expect(added.isActive).toBe(false)
    expect(added.identityId).toBeNull()
    expect(added.passwordHash).toBeNull()
    expect(
      (
        await request(app)
          .post(path)
          .set(signed('POST', path))
          .set('Authorization', `Bearer ${a.accessToken}`)
          .send({ ...body, email: 'bad@test.example', roleId: b.user.roleId })
      ).status
    ).toBe(404)
  })
})
