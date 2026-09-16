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
async function prepare(roleName?: string) {
  const f = await fixtures()
  if (roleName) {
    const role = await db.role.findFirstOrThrow({ where: { tenantId: f.a.user.tenantId, name: roleName } })
    await db.user.update({ where: { id: f.a.user.id, tenantId: f.a.user.tenantId }, data: { roleId: role.id } })
  }
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
  it('redirects a single-tenant Teller to its slug and keeps the Teller role after handoff', async () => {
    const p = await prepare('Teller')
    const role = await db.role.findFirstOrThrow({ where: { tenantId: p.a.user.tenantId, name: 'Teller' } })
    const config = await request(app).get('/api/tenant-access/config')
    expect(config.body.data.enabled).toBe(true)
    const path = '/api/tenant-access/redeem'
    const res = await request(app).post(path).set(signed('POST', path)).set('Cookie', p.binding)
      .send({ attempt: p.attempt, state: p.state, code: p.code })
    expect(res.status).toBe(200)
    expect(res.body.data.user).toMatchObject({ tenantId: p.a.user.tenantId, roleId: role.id, roleName: 'Teller' })
    expect(res.body.data.user.permissions).toEqual(role.permissions)
  })
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

const handoffPath = '/api/tenant-access/handoff'
const acceptPath = '/api/tenant-access/accept'
async function directTicket(response: request.Response, targetApp = app) {
  const attempt = response.body.data.handoff.attempt as string
  const bridge = await request(targetApp).post(handoffPath).set('Origin', central)
    .set('Cookie', cookie(response)).type('form').send({ attempt })
  expect(bridge.status).toBe(200)
  expect(bridge.headers['content-type']).toContain('text/html')
  expect(bridge.headers['cache-control']).toContain('no-store')
  expect(bridge.headers['referrer-policy']).toBe('origin')
  expect(bridge.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  const code = bridge.text.match(/name="code" value="([\w-]+)"/)?.[1]
  expect(code).toHaveLength(43)
  return { attempt, code: code! }
}
function acceptDirect(body: { attempt: string; code: string }, slug = 'alpha', origin = central, targetApp = app) {
  return request(targetApp).post(acceptPath).set(signed('POST', acceptPath, slug))
    .set('Origin', origin).type('form').send(body)
}
describe('direct staff handoff', () => {
  it('transfers a Teller session with a host-only cookie and no tokens in the redirect', async () => {
    const { a } = await fixtures()
    const role = await db.role.findFirstOrThrow({ where: { tenantId: a.user.tenantId, name: 'Teller' } })
    await db.user.update({ where: { id: a.user.id, tenantId: a.user.tenantId }, data: { roleId: role.id } })
    const ticket = await directTicket(await login())
    const res = await acceptDirect(ticket)
    expect(res.status).toBe(303)
    expect(res.headers.location).toBe('/dashboard?handoff=1')
    expect(cookie(res)).toContain('siskop_refresh_token=')
    expect(res.headers['set-cookie'].join(';')).toContain('HttpOnly; Secure; SameSite=Strict')
    expect(res.headers['set-cookie'].join(';')).not.toContain('Domain=')
    const path = '/api/auth/refresh'
    const restored = await request(app).post(path).set(signed('POST', path)).set('Cookie', cookie(res)).send({})
    expect(restored.status).toBe(200)
    const mePath = '/api/auth/me'
    const me = await request(app).get(mePath).set(signed('GET', mePath))
      .set('Authorization', `Bearer ${restored.body.data.accessToken}`)
    expect(me.body.data).toMatchObject({ id: a.user.id, tenantId: a.user.tenantId, roleName: 'Teller' })
    expect(me.body.data.permissions).toEqual(role.permissions)
  })
  it('requires the initiating identity cookie and the exact central source', async () => {
    await fixtures()
    const response = await login()
    const attempt = response.body.data.handoff.attempt
    for (const origin of ['https://evil.example', 'null']) {
      await request(app).post(handoffPath).set('Origin', origin).set('Cookie', cookie(response))
        .type('form').send({ attempt }).expect(403)
    }
    await request(app).post(handoffPath).set('Origin', central).type('form').send({ attempt }).expect(401)
    const other = await login()
    await request(app).post(handoffPath).set('Origin', central).set('Cookie', cookie(other))
      .type('form').send({ attempt }).expect(401)
    const ticket = await directTicket(response)
    await request(app).post(handoffPath).set('Origin', central).set('Cookie', cookie(response))
      .type('form').send({ attempt }).expect(401)
    for (const origin of ['https://evil.example', central + '.evil.example', 'null', `https://alpha.${base}`]) {
      const denied = await acceptDirect(ticket, 'alpha', origin)
      expect(denied.status).toBe(403)
      expect(denied.headers['set-cookie']).toBeUndefined()
    }
    const headers = signed('POST', acceptPath)
    const { Origin: _origin, ...withoutOrigin } = headers
    await request(app).post(acceptPath).set(withoutOrigin).type('form').send(ticket).expect(403)
    await acceptDirect(ticket, 'beta').expect(403)
    await request(app).post(acceptPath).set('Origin', central).type('form').send(ticket).expect(403)
    await request(app).post(acceptPath).set(signed('POST', acceptPath)).set('Origin', central)
      .set('Sec-Fetch-Dest', 'iframe').type('form').send(ticket).expect(403)
    // The workspace middleware exception must not apply to neighboring routes.
    const refreshPath = '/api/auth/refresh'
    await request(app).post(refreshPath).set(signed('POST', refreshPath)).set('Origin', central).send({}).expect(403)
    await request(app).get(acceptPath).set(signed('GET', acceptPath)).expect(404)
    await acceptDirect(ticket).expect(303)
  })
  it('rejects expired tickets, tampering and concurrent replay', async () => {
    await fixtures()
    const ticket = await directTicket(await login())
    await acceptDirect({ ...ticket, code: 'x'.repeat(43) }).expect(401)
    await db.tenantLoginAttempt.update({ where: { id: ticket.attempt }, data: { codeExpiresAt: new Date(0) } })
    const expired = await acceptDirect(ticket).expect(401)
    expect(expired.headers['content-type']).toContain('text/html')
    expect(expired.text).toContain('Kembali ke halaman masuk')
    expect(expired.text).not.toContain(ticket.code)
    const fresh = await directTicket(await login())
    const results = await Promise.all([acceptDirect(fresh), acceptDirect(fresh)])
    expect(results.map(r => r.status).sort()).toEqual([303, 401])
    expect(results.find(r => r.status === 401)!.headers['set-cookie']).toBeUndefined()
  })
  it('rechecks membership, identity, session, unit access and canonical slug before accepting', async () => {
    const { a, identity } = await fixtures()
    const changes = [
      async () => { await db.user.update({ where: { id: a.user.id, tenantId: a.user.tenantId }, data: { isActive: false } }) },
      async () => { await db.accountIdentity.update({ where: { id: identity.id }, data: { isActive: false } }) },
      async () => { await db.identitySession.updateMany({ data: { expiresAt: new Date(0) } }) },
      async () => { await db.cooperativeUnit.updateMany({ where: { tenantId: a.user.tenantId }, data: { isActive: false } }) },
      async () => { await db.tenant.update({ where: { id: a.user.tenantId }, data: { slug: 'renamed-alpha' } }) },
    ]
    for (const change of changes) {
      const ticket = await directTicket(await login())
      await change()
      const rejected = await acceptDirect(ticket)
      expect([401, 403, 409]).toContain(rejected.status)
      expect(rejected.headers['set-cookie']).toBeUndefined()
      await db.user.update({ where: { id: a.user.id, tenantId: a.user.tenantId }, data: { isActive: true } })
      await db.accountIdentity.update({ where: { id: identity.id }, data: { isActive: true } })
      await db.cooperativeUnit.updateMany({ where: { tenantId: a.user.tenantId }, data: { isActive: true } })
      await db.tenant.update({ where: { id: a.user.tenantId }, data: { slug: 'alpha' } })
    }
  })
  it('selects a second authorized tenant through Firebase Hosting and keeps member cookies separate', async () => {
    const { b } = await fixtures(true)
    const hosted = express().use(firebaseHosting(), createApp())
    const response = await request(hosted).post('/api/tenant-access/login').set('Origin', central).send({ idToken: 'person-uid' })
    expect(response.body.data.next).toBe('tenant_selection')
    const identityCookie = (response.headers['set-cookie'] as unknown as string[]).filter(c => c.includes('Path=/api/tenant-access'))
    const selected = await request(hosted).post('/api/tenant-access/select').set('Origin', central)
      .set('Cookie', identityCookie.map(c => c.split(';')[0]).join('; ')).send({ tenantId: b.user.tenantId })
    expect(selected.status).toBe(200)
    selected.headers['set-cookie'] = identityCookie
    const ticket = await directTicket(selected, hosted)
    const accepted = await acceptDirect(ticket, 'beta', central, hosted)
    expect(accepted.status).toBe(303)
    expect(cookie(accepted)).not.toMatch(/__session|member/)
  })
  it('keeps legacy browser-bound codes separate from direct tickets', async () => {
    const legacy = await prepare()
    await acceptDirect({ attempt: legacy.attempt!, code: legacy.code! }).expect(401)
    const direct = await directTicket(await login())
    const path = '/api/tenant-access/start'
    await request(app).post(path).set(signed('POST', path)).send({ attempt: direct.attempt }).expect(401)
    await acceptDirect(direct).expect(303)
  })
})
