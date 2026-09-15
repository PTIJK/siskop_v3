import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { db } from '../src/lib/db.js'
import { firebaseHosting } from '../src/hosting/firebase.js'

const central = 'https://siskop-d0f8c.web.app'
const base = 'koperasi.inovasijayakarsa.id'
const key = 'member-access-test-gateway-secret-only'
const nik = '1234556787654321'
const password = 'Member-test-only-123'
let api = createApp()
const path = (step: string) => `/api/member-access/${step}`
const cookies = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]).join('; ')
function signed(step: string, slug = 'alpha') {
  const host = `${slug}.${base}`,
    time = String(Date.now())
  return {
    Origin: `https://${host}`,
    'x-siskop-host': host,
    'x-siskop-time': time,
    'x-siskop-signature': createHmac('sha256', key)
      .update([time, 'POST', path(step), host].join('\n'))
      .digest('base64url')
  }
}
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/missing').pathname.endsWith('_test'))
    throw new Error('Use an isolated _test database.')
  api = createApp()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('JWT_SECRET', 'test-secret')
  vi.stubEnv('JWT_REFRESH_SECRET', 'test-refresh')
  vi.stubEnv('TENANT_DOMAINS_ENABLED', 'true')
  vi.stubEnv('TENANT_BASE_DOMAIN', base)
  vi.stubEnv('TENANT_GATEWAY_SECRET', key)
  vi.stubEnv('PUBLIC_APP_URL', central)
  await db.tenant.deleteMany({})
  await db.memberLoginSession.deleteMany({})
})
afterEach(() => vi.unstubAllEnvs())
async function member(slug: string, memberPassword: string | null = password) {
  const tenant = await db.tenant.create({
    data: { name: `Koperasi ${slug}`, slug, registrationNo: slug, address: 'Preview', type: 'KONVENSIONAL' }
  })
  return db.member.create({
    data: {
      tenantId: tenant.id,
      memberId: `MEM-${slug}`,
      accountNumber: `ACC-${slug}`,
      fullName: 'Test Member',
      nik,
      address: 'Preview',
      birthPlace: 'Jakarta',
      birthDate: new Date('1990-01-01'),
      occupation: 'Test',
      passwordHash: memberPassword ? await bcrypt.hash(memberPassword, 10) : null,
      mustChangePassword: true
    }
  })
}
const login = (body = { nik, password }) => request(api).post(path('login')).set('Origin', central).send(body)
async function prepared() {
  const m = await member('alpha')
  const loggedIn = await login()
  expect(loggedIn.status).toBe(200)
  const attempt = new URL(loggedIn.body.data.startUrl).searchParams.get('attempt')
  const started = await request(api).post(path('start')).set(signed('start')).send({ attempt })
  expect(started.status).toBe(200)
  const state = new URLSearchParams(new URL(started.body.data.authorizeUrl).hash.slice(1)).get('state')
  const authorized = await request(api)
    .post(path('authorize'))
    .set('Origin', central)
    .set('Cookie', cookies(loggedIn))
    .send({ attempt, state })
  expect(authorized.status).toBe(200)
  const code = new URLSearchParams(new URL(authorized.body.data.callbackUrl).hash.slice(1)).get('code')
  return { m, attempt, state, code, binding: cookies(started), centralCookie: cookies(loggedIn) }
}
describe('generic member login', () => {
  it('auto-selects one credential-verified membership without issuing a central member session', async () => {
    await member('alpha')
    const res = await login()
    expect(res.status).toBe(200)
    expect(res.body.data.next).toBe('tenant_redirect')
    expect(new URL(res.body.data.startUrl).origin).toBe(`https://alpha.${base}`)
    expect(res.body.data.accessToken).toBeUndefined()
    expect(cookies(res)).not.toContain('siskop_member_refresh_token')
  })
  it('offers only memberships whose password matches, excluding inactive and unactivated accounts', async () => {
    const a = await member('alpha'),
      b = await member('beta')
    await member('different', 'Different-password-123')
    await member('unactivated', null)
    const inactive = await member('inactive')
    await db.member.update({
      where: { id: inactive.id, tenantId: inactive.tenantId },
      data: { isActive: false }
    })
    const disabled = await member('disabled')
    await db.tenant.update({ where: { id: disabled.tenantId }, data: { isActive: false } })
    const res = await login()
    expect(res.body.data.next).toBe('tenant_selection')
    expect(res.body.data.memberships.map((m: { membershipId: string }) => m.membershipId).sort()).toEqual(
      [a.id, b.id].sort()
    )
    expect(JSON.stringify(res.body.data)).not.toContain('passwordHash')
    const selected = await request(api)
      .post(path('select'))
      .set('Origin', central)
      .set('Cookie', cookies(res))
      .send({ membershipId: b.id })
    expect(new URL(selected.body.data.startUrl).origin).toBe(`https://beta.${base}`)
    const denied = await request(api)
      .post(path('select'))
      .set('Origin', central)
      .set('Cookie', cookies(res))
      .send({ membershipId: inactive.id })
    expect(denied.status).toBe(401)
  })
  it('uses the same generic failure for absent NIK and wrong password', async () => {
    await member('alpha')
    const wrong = await login({ nik, password: 'wrong' })
    const missing = await login({ nik: '9999999999999999', password })
    expect(wrong.status).toBe(401)
    expect(missing.body.error).toEqual(wrong.body.error)
  })
  it('rejects untrusted origins, tenant-site discovery and disabled tenant routing', async () => {
    expect((await request(api).post(path('login')).send({ nik, password })).status).toBe(403)
    await member('alpha')
    expect((await request(api).post(path('login')).set(signed('login')).send({ nik, password })).status).toBe(
      403
    )
    vi.stubEnv('TENANT_DOMAINS_ENABLED', 'false')
    expect((await login()).status).toBe(403)
  })
  it('translates the central selection cookie through Firebase Hosting', async () => {
    const a = await member('alpha')
    await member('beta')
    const hosting = express().use(firebaseHosting()).use(api)
    const res = await request(hosting).post(path('login')).set('Origin', central).send({ nik, password })
    expect(cookies(res)).toMatch(/^__session=/)
    expect(res.headers['set-cookie'][0]).toContain('Path=/api/member-access')
    const select = await request(hosting)
      .post(path('select'))
      .set('Origin', central)
      .set('Cookie', cookies(res))
      .send({ membershipId: a.id })
    expect(select.status).toBe(200)
  })
})
describe('member handoff', () => {
  it('redeems once on the selected host and preserves the forced password change', async () => {
    const p = await prepared()
    const redeem = () =>
      request(api)
        .post(path('redeem'))
        .set(signed('redeem'))
        .set('Cookie', p.binding)
        .send({ attempt: p.attempt, state: p.state, code: p.code })
    const responses = await Promise.all([redeem(), redeem()])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401])
    const success = responses.find((r) => r.status === 200)!
    expect(success.body.data.member.id).toBe(p.m.id)
    expect(success.body.data.member.mustChangePassword).toBe(true)
    expect(cookies(success)).toContain('siskop_member_refresh_token=')
    expect(success.body.data.refreshToken).toBeUndefined()
    const me = await request(api)
      .get('/api/member-auth/me')
      .set('Authorization', `Bearer ${success.body.data.accessToken}`)
    expect(me.status).toBe(200)
  })
  it('rejects a stolen callback, wrong state, wrong code and the wrong tenant host', async () => {
    const p = await prepared()
    await member('beta')
    const data = { attempt: p.attempt, state: p.state, code: p.code }
    expect((await request(api).post(path('redeem')).set(signed('redeem')).send(data)).status).toBe(401)
    for (const bad of [
      { ...data, state: 'x'.repeat(43) },
      { ...data, code: 'x'.repeat(43) }
    ]) {
      expect(
        (await request(api).post(path('redeem')).set(signed('redeem')).set('Cookie', p.binding).send(bad))
          .status
      ).toBe(401)
    }
    expect(
      (
        await request(api)
          .post(path('redeem'))
          .set(signed('redeem', 'beta'))
          .set('Cookie', p.binding)
          .send(data)
      ).status
    ).toBe(403)
  })
  it('requires the original central browser to authorize an attempt', async () => {
    const p = await prepared()
    const other = await login()
    expect(
      (
        await request(api)
          .post(path('authorize'))
          .set('Origin', central)
          .set('Cookie', cookies(other))
          .send({ attempt: p.attempt, state: p.state })
      ).status
    ).toBe(401)
  })
  it.each(['password', 'member', 'tenant', 'slug', 'expiry'] as const)(
    'rejects a handoff after %s changes',
    async (change) => {
      const p = await prepared()
      if (change === 'password')
        await db.member.update({
          where: { id: p.m.id, tenantId: p.m.tenantId },
          data: { passwordHash: await bcrypt.hash('Changed-password-123', 10) }
        })
      if (change === 'member')
        await db.member.update({ where: { id: p.m.id, tenantId: p.m.tenantId }, data: { isActive: false } })
      if (change === 'tenant')
        await db.tenant.update({ where: { id: p.m.tenantId }, data: { isActive: false } })
      if (change === 'slug')
        await db.tenant.update({ where: { id: p.m.tenantId }, data: { slug: 'renamed' } })
      if (change === 'expiry') await db.memberLoginSession.updateMany({ data: { expiresAt: new Date(0) } })
      const res = await request(api)
        .post(path('redeem'))
        .set(signed('redeem'))
        .set('Cookie', p.binding)
        .send({ attempt: p.attempt, state: p.state, code: p.code })
      if (change === 'slug') {
        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('WORKSPACE_MOVED')
      } else expect([401, 403, 404]).toContain(res.status)
    }
  )
  it('rejects an expired code and a repeated start', async () => {
    const p = await prepared()
    expect(
      (await request(api).post(path('start')).set(signed('start')).send({ attempt: p.attempt })).status
    ).toBe(401)
    await db.memberLoginAttempt.update({ where: { id: p.attempt! }, data: { codeExpiresAt: new Date(0) } })
    expect(
      (
        await request(api)
          .post(path('redeem'))
          .set(signed('redeem'))
          .set('Cookie', p.binding)
          .send({ attempt: p.attempt, state: p.state, code: p.code })
      ).status
    ).toBe(401)
  })
  it('requires a valid session and verified membership when selecting', async () => {
    const a = await member('alpha')
    await member('beta')
    const res = await login()
    expect(
      (await request(api).post(path('select')).set('Origin', central).send({ membershipId: a.id })).status
    ).toBe(401)
    await db.member.update({
      where: { id: a.id, tenantId: a.tenantId },
      data: { passwordHash: await bcrypt.hash('Changed-password-123', 10) }
    })
    expect(
      (
        await request(api)
          .post(path('select'))
          .set('Origin', central)
          .set('Cookie', cookies(res))
          .send({ membershipId: a.id })
      ).status
    ).toBe(401)
  })
  it('limits repeated login attempts without exposing membership information', async () => {
    for (let i = 0; i < 10; i++) expect((await login({ nik, password: 'wrong' })).status).toBe(401)
    const limited = await login({ nik, password: 'wrong' })
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMIT')
  })
})
