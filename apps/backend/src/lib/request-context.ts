import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The ambient actor context an authenticated request carries for the life of
 * that request, seeded by requireAuth (middleware/auth.ts) right where it
 * sets req.auth. recordAudit (modules/audit-log/service.ts) reads this so
 * mutation service functions don't need an `actor` parameter threaded
 * through every call site — they just call recordAudit(tx, {...}) and it
 * fills in who/where from here.
 */
export interface RequestContext {
  tenantId: string;
  actorUserId: string | null;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Unlike `withoutTenantScope`'s `bypassStorage` (lib/tenant-scope.ts), which
 * must never return an unawaited PrismaPromise out of its callback, this is
 * safe to wrap around a synchronous `next()` call: `AsyncLocalStorage.run()`
 * propagates its store to everything scheduled synchronously during the
 * callback, and to every promise/timer created during that synchronous
 * window — which covers the rest of the Express pipeline (every downstream
 * middleware, the route handler, and every `await db.xxx()` inside it),
 * since `next()` synchronously invokes the next handler in the chain. Do not
 * "simplify" this into something that awaits before calling `next()` — that
 * would tear down the store before the handlers that need it run.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
