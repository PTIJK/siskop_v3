import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

/**
 * Models carrying a direct `tenantId` column (see prisma/schema.prisma).
 * Kept as a literal list rather than derived from `Prisma.dmmf` at runtime so
 * a schema change that adds/removes tenantId on a model shows up as a diff
 * here, in review, instead of silently changing what this guard enforces.
 */
const TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>([
  "CooperativeUnit",
  "Role",
  "User",
  "Member",
  "SavingConfig",
  "WhitelabelConfig",
  "Saving",
  "SavingTransaction",
  "LoanConfig",
  "Loan",
  "LoanPayment",
  "Account",
  "AccountMapping",
  "JournalEntry",
  "JournalLine",
  "ShuDistributionConfig",
  "CalkNarrative",
  // Phase 2 (KSU Konsumen/Toko), Task 2 — only the two models that task's
  // service layer actually queries by tenantId.
  "Product",
  "StockMovement",
  // Phase 2, Task 3 — sale.service.ts now queries POSSale by tenantId.
  // POSSaleLine is deliberately NOT added: it carries no tenantId column of
  // its own (only saleId), so this guard doesn't apply to it — see
  // modules/konsumen/sale.service.ts.
  "POSSale",
  // Phase 2, Task 4 — ppob.service.ts now queries/creates PPOBTransaction by
  // tenantId (a stub check-and-pay skeleton, no journal posting involved).
  "PPOBTransaction"
]);

const WHERE_REQUIRED_ACTIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany"
]);

const bypassStorage = new AsyncLocalStorage<boolean>();

/**
 * Escape hatch for the handful of legitimate cross-tenant queries — platform
 * admin operations on `User` rows gated by `isPlatformAdmin`, not tenantId
 * (see modules/platform/service.ts). Wrap only the specific call, not a whole
 * request handler, so the bypass can't silently swallow an unrelated query
 * that should have been scoped.
 */
export function withoutTenantScope<T>(fn: () => Promise<T>): Promise<T> {
  // Must await *inside* the callback, not just return fn()'s promise: Prisma
  // defers the actual query (and this guard's check) to when the returned
  // PrismaPromise is awaited, which happens after `run()` would otherwise
  // have already exited its synchronous window and torn down the store.
  return bypassStorage.run(true, async () => fn());
}

/**
 * Looks for a tenantId condition in a Prisma `where` clause. Handles the
 * shapes this codebase actually writes: a flat `tenantId`, a compound-unique
 * wrapper Prisma generates for `@@unique([tenantId, ...])` fields (always
 * named `tenantId_<rest>` here, since tenantId leads every such constraint
 * in schema.prisma), a `tenant: { ... }` relation filter, and `AND`/`OR`
 * combinators.
 */
function hasTenantScope(where: unknown, depth = 0): boolean {
  if (depth > 4 || !where || typeof where !== "object" || Array.isArray(where)) return false;
  const clause = where as Record<string, unknown>;

  if (typeof clause.tenantId === "string") return true;
  if (clause.tenant && typeof clause.tenant === "object") return true;

  for (const [key, value] of Object.entries(clause)) {
    if (key.startsWith("tenantId_") && value && typeof value === "object") return true;
  }

  if (Array.isArray(clause.AND) && clause.AND.some((v) => hasTenantScope(v, depth + 1))) return true;
  if (Array.isArray(clause.OR) && clause.OR.length > 0 && clause.OR.every((v) => hasTenantScope(v, depth + 1))) {
    return true;
  }

  return false;
}

function hasTenantIdInData(data: unknown): boolean {
  return !!data && typeof data === "object" && typeof (data as Record<string, unknown>).tenantId === "string";
}

function refuse(model: string, operation: string): never {
  throw new Error(
    `Refusing ${model}.${operation}: no tenantId filter/value found. ` +
      "Every query on a tenant-scoped model must filter by tenantId (CLAUDE.md rule 1). " +
      "If this is a genuine cross-tenant platform-admin query, wrap it in withoutTenantScope()."
  );
}

/**
 * Defense-in-depth guard, not the primary access control: it only checks
 * that a tenantId condition is *present*, not that it matches the caller's
 * `req.auth.tenantId` (this client is a singleton with no request context).
 * Call sites remain responsible for sourcing that value correctly — this
 * just turns "forgot the filter entirely" from a silent cross-tenant leak
 * into a thrown error.
 *
 * `findUnique`/`findUniqueOrThrow` are deliberately not checked: their
 * `where` keys off a unique field (usually bare `id`), which for these
 * models is never tenantId alone, so the codebase's established pattern is
 * to fetch by id and then compare `.tenantId` against the caller's tenant
 * before use (see modules/savings/service.ts, modules/loans/service.ts).
 */
export const tenantScopeExtension = Prisma.defineExtension({
  name: "tenant-scope-guard",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_SCOPED_MODELS.has(model) || bypassStorage.getStore()) {
          return query(args);
        }

        if (WHERE_REQUIRED_ACTIONS.has(operation)) {
          const where = (args as { where?: unknown } | undefined)?.where;
          if (!hasTenantScope(where)) refuse(model, operation);
        } else if (operation === "create") {
          const data = (args as { data?: unknown }).data;
          if (!hasTenantIdInData(data)) refuse(model, operation);
        } else if (operation === "createMany" || operation === "createManyAndReturn") {
          const data = (args as { data?: unknown }).data;
          const rows = Array.isArray(data) ? data : [data];
          if (rows.length === 0 || !rows.every(hasTenantIdInData)) refuse(model, operation);
        } else if (operation === "upsert") {
          const { where, create } = args as { where?: unknown; create?: unknown };
          if (!hasTenantScope(where) || !hasTenantIdInData(create)) refuse(model, operation);
        }

        return query(args);
      }
    }
  }
});
