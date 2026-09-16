import { ErrorCode } from '@siskop/types'
import { Router, urlencoded, type Request, type Response, type NextFunction } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { AppError, forbidden } from '../../lib/errors.js'
import { requireAuth, authClaims } from '../../middleware/auth.js'
import { clearRefreshCookie, setRefreshCookie } from '../auth/refresh-cookie.js'
import { centralUrl, selectionEnabled, switchingEnabled } from './config.js'
import {
  identitySession,
  login,
  memberships,
  selectTenant,
  startAttempt,
  authorizeAttempt,
  redeemAttempt,
  issueDirectTicket,
  acceptDirectTicket,
  logout
} from './service.js'
import { firebaseUidFor } from './identity.js'
import { db } from '../../lib/db.js'
import { acceptInvitation } from './invitations.js'
import { sendHandoffForm, sendHandoffError } from './handoff-html.js'

const NAME = 'siskop_identity'
const PATH = '/api/tenant-access'
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next)
  }
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: PATH }
const attemptSchema = z.object({ attempt: z.string().cuid() })
const stateSchema = attemptSchema.extend({ state: z.string().regex(/^[\w-]{43}$/) })
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
function sameOrigin(req: Request) {
  const origin = req.workspace ? destination(req) : new URL(centralUrl()).origin
  if (req.get('Origin') !== origin) throw forbidden('Origin not allowed')
}
export function tenantAccessRoutes() {
  const router = Router()
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
    next()
  })
  router.get('/config', (_req, res) =>
    result(res, { enabled: selectionEnabled(), switching: switchingEnabled(), centralUrl: centralUrl() })
  )
  router.use((_req, _res, next) => {
    if (!selectionEnabled()) return next(forbidden('Pemilihan koperasi belum diaktifkan.'))
    next()
  })
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) =>
        res
          .status(429)
          .json({
            success: false,
            error: { code: ErrorCode.RATE_LIMIT, message: 'Terlalu banyak permintaan. Coba lagi sebentar.' },
            meta: res.locals.meta
          })
    })
  )
  router.use((req, _res, next) => {
    try {
      if (req.method !== 'GET') {
        if (req.path === '/accept') {
          // This is the only cross-origin POST. Never accept a missing/null
          // Origin or fall back to Referer, even when the ticket is valid.
          destination(req)
          if (req.get('Origin') !== new URL(centralUrl()).origin) throw forbidden('Origin not allowed')
        } else sameOrigin(req)
      }
      next()
    } catch (e) {
      next(e)
    }
  })
  const formBody = urlencoded({ extended: false, limit: '2kb', parameterLimit: 3 })
  const topLevel = (req: Request) => {
    if ((req.get('Sec-Fetch-Dest') && req.get('Sec-Fetch-Dest') !== 'document') ||
        (req.get('Sec-Fetch-Mode') && req.get('Sec-Fetch-Mode') !== 'navigate'))
      throw forbidden('Gunakan halaman masuk pusat.')
  }
  router.post('/handoff', formBody, handle(async (req, res) => {
    centralOnly(req)
    topLevel(req)
    const { attempt } = attemptSchema.parse(req.body)
    const ticket = await issueDirectTicket(attempt, await identitySession(req.cookies[NAME]))
    sendHandoffForm(res, ticket)
  }))
  router.post('/accept', formBody, handle(async (req, res) => {
    topLevel(req)
    const { attempt, code } = attemptSchema.extend({ code: z.string().regex(/^[\w-]{43}$/) }).parse(req.body)
    const session = await acceptDirectTicket(attempt, code, destination(req))
    setRefreshCookie(res, session.refreshToken)
    // The query flag requests a fresh /me before rendering any cached account.
    // It carries no credentials and does not authorize the dashboard itself.
    res.redirect(303, '/dashboard?handoff=1')
  }))
  router.post(
    '/login',
    handle(async (req, res) => {
      centralOnly(req)
      const { idToken } = z.object({ idToken: z.string().min(1).max(10000) }).parse(req.body)
      await logout(req.cookies[NAME])
      const response = await login(idToken)
      clearRefreshCookie(res)
      if (response.token)
        res.cookie(NAME, response.token, {
          ...cookieOptions,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 8 * 60 * 60_000
        })
      else res.clearCookie(NAME, { path: PATH })
      if (response.result.next === 'dashboard') {
        const { refreshToken, ...session } = response.result.session
        setRefreshCookie(res, refreshToken)
        result(res, { next: 'dashboard', session })
      } else if (response.result.next === 'checkout') {
        // Keep the existing checkout cookie/flow available on its own path.
        res.cookie('siskop_onboarding', response.result.order.id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          path: '/api/onboarding',
          maxAge: 7 * 86400_000
        })
        result(res, response.result)
      } else result(res, response.result)
    })
  )
  router.get(
    '/memberships',
    handle(async (req, res) => {
      centralOnly(req)
      const session = await identitySession(req.cookies[NAME])
      const input = z
        .object({
          search: z.string().max(100).default(''),
          page: z.coerce.number().int().min(1).max(100000).default(1)
        })
        .parse(req.query)
      result(res, await memberships(session.identityId, input.search, input.page))
    })
  )
  router.post(
    '/select',
    handle(async (req, res) => {
      centralOnly(req)
      const session = await identitySession(req.cookies[NAME])
      const { tenantId, membershipId } = z
        .object({ tenantId: z.string().min(1).max(100), membershipId: z.string().min(1).max(100).optional() })
        .parse(req.body)
      result(res, await selectTenant(session, tenantId, membershipId))
    })
  )
  router.post(
    '/start',
    handle(async (req, res) => {
      const { attempt } = attemptSchema.parse(req.body)
      const data = await startAttempt(attempt, destination(req))
      res.cookie(`siskop_handoff_${attempt}`, data.binding, {
        ...cookieOptions,
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
      const { attempt, state } = stateSchema.parse(req.body)
      result(res, await authorizeAttempt(attempt, state, await identitySession(req.cookies[NAME])))
    })
  )
  router.post(
    '/redeem',
    handle(async (req, res) => {
      const { attempt, state, code } = stateSchema.extend({ code: z.string().regex(/^[\w-]{43}$/) }).parse(req.body)
      const { refreshToken, ...session } = await redeemAttempt(
        attempt,
        code,
        state,
        req.cookies[`siskop_handoff_${attempt}`],
        destination(req)
      )
      res.clearCookie(`siskop_handoff_${attempt}`, { path: PATH })
      setRefreshCookie(res, refreshToken)
      result(res, session)
    })
  )
  router.post(
    '/logout',
    handle(async (req, res) => {
      centralOnly(req)
      await logout(req.cookies[NAME])
      res.clearCookie(NAME, { path: PATH })
      clearRefreshCookie(res)
      result(res, { message: 'Keluar berhasil' })
    })
  )
  router.post(
    '/accept-invitation',
    handle(async (req, res) => {
      centralOnly(req)
      const input = z
        .object({ token: z.string().regex(/^[\w-]{43}$/), idToken: z.string().min(1).max(10000) })
        .parse(req.body)
      result(res, await acceptInvitation(input.token, input.idToken))
    })
  )
  router.get(
    ['/switch-options', '/switch-memberships'],
    requireAuth,
    handle(async (req, res) => {
      if (!switchingEnabled()) throw forbidden('Pergantian koperasi belum diaktifkan.')
      destination(req)
      const auth = authClaims(req)
      const user = await db.user.findUnique({ where: { id: auth.userId, tenantId: auth.tenantId } })
      if (!user?.isActive || !user.identityId || user.isPlatformAdmin)
        return result(res, { total: 0, items: [], filteredTotal: 0, page: 1 })
      await firebaseUidFor(user)
      const input = z
        .object({
          search: z.string().max(100).default(''),
          page: z.coerce.number().int().min(1).max(100000).default(1)
        })
        .parse(req.query)
      const page = await memberships(user.identityId, input.search, input.page)
      result(
        res,
        req.path === '/switch-memberships' ? page : { total: page.total, currentTenantName: req.workspace!.name }
      )
    })
  )
  router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (req.path !== '/handoff' && req.path !== '/accept') return next(err)
    if (!(err instanceof AppError) && !(err instanceof z.ZodError)) console.error('Staff handoff failed', err)
    sendHandoffError(res, err instanceof AppError ? err.status : err instanceof z.ZodError ? 422 : 500)
  })
  return router
}
