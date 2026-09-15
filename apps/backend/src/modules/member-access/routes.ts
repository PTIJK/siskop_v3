import { Router, type Request, type Response, type NextFunction } from 'express'
import { rateLimit } from 'express-rate-limit'
import { ErrorCode } from '@siskop/types'
import { z } from 'zod'
import { forbidden } from '../../lib/errors.js'
import { centralUrl } from '../tenant-access/config.js'
import { tenantDomainsEnabled } from '../tenant-domains/config.js'
import { setRefreshCookie } from '../auth/refresh-cookie.js'
import { authorize, digest, login, redeem, select, sessionFor, start } from './service.js'

const NAME = 'siskop_member_selection'
const PATH = '/api/member-access'
const options = { httpOnly: true, sameSite: 'lax' as const, path: PATH }
const attemptBody = z.object({ attempt: z.string().cuid() })
const stateBody = attemptBody.extend({ state: z.string().regex(/^[\w-]{43}$/) })
const loginBody = z.object({
  nik: z
    .string()
    .trim()
    .regex(/^\d{16}$/, 'NIK harus 16 digit.'),
  password: z.string().min(1).max(256)
})
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next)
  }
function result(res: Response, data: unknown) {
  res.json({ success: true, data, meta: res.locals.meta })
}
function centralOnly(req: Request) {
  if (req.workspace) throw forbidden('Gunakan halaman masuk pusat.')
}
function destination(req: Request) {
  if (!req.workspace || !req.workspaceHost) throw forbidden('Gunakan alamat koperasi.')
  return new URL(req.workspace.canonicalLoginUrl).origin
}
const limited = (_req: Request, res: Response) =>
  res
    .status(429)
    .json({
      success: false,
      error: { code: ErrorCode.RATE_LIMIT, message: 'Terlalu banyak percobaan. Coba lagi sebentar.' },
      meta: res.locals.meta
    })
export function memberAccessRoutes() {
  const router = Router()
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    try {
      if (!tenantDomainsEnabled()) throw forbidden('Masuk melalui alamat koperasi Anda.')
      const origin = req.workspace ? destination(req) : new URL(centralUrl()).origin
      if (req.get('Origin') !== origin) throw forbidden('Origin not allowed')
      next()
    } catch (e) {
      next(e)
    }
  })
  router.use(
    rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, handler: limited })
  )
  router.post(
    '/login',
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => digest(String(req.body?.nik ?? '').trim()),
      handler: limited
    }),
    handle(async (req, res) => {
      centralOnly(req)
      const input = loginBody.parse(req.body)
      const data = await login(input.nik, input.password, req.cookies[NAME])
      res.cookie(NAME, data.token, {
        ...options,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 5 * 60_000
      })
      result(res, data.result)
    })
  )
  router.post(
    '/select',
    handle(async (req, res) => {
      centralOnly(req)
      const session = await sessionFor(req.cookies[NAME])
      const { membershipId } = z.object({ membershipId: z.string().cuid() }).parse(req.body)
      result(res, await select(session.id, membershipId))
    })
  )
  router.post(
    '/start',
    handle(async (req, res) => {
      const { attempt } = attemptBody.parse(req.body)
      const data = await start(attempt, destination(req))
      res.cookie(`siskop_member_handoff_${attempt}`, data.binding, {
        ...options,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 5 * 60_000
      })
      result(res, { authorizeUrl: data.authorizeUrl })
    })
  )
  router.post(
    '/authorize',
    handle(async (req, res) => {
      centralOnly(req)
      const session = await sessionFor(req.cookies[NAME])
      const { attempt, state } = stateBody.parse(req.body)
      result(res, await authorize(attempt, state, session.id))
    })
  )
  router.post(
    '/redeem',
    handle(async (req, res) => {
      const { attempt, state, code } = stateBody
        .extend({ code: z.string().regex(/^[\w-]{43}$/) })
        .parse(req.body)
      const { refreshToken, ...session } = await redeem(
        attempt,
        state,
        code,
        req.cookies[`siskop_member_handoff_${attempt}`],
        destination(req)
      )
      res.clearCookie(`siskop_member_handoff_${attempt}`, { path: PATH })
      setRefreshCookie(res, refreshToken, { name: 'siskop_member_refresh_token', path: '/api/member-auth' })
      result(res, session)
    })
  )
  return router
}
