import type { Request } from "express";

/**
 * Express's `ParamsDictionary` is an index signature, so `noUncheckedIndexedAccess`
 * (tsconfig.base.json) types every `req.params.x` as `string | undefined` even
 * on a route declared `/:x`. This narrows it back to `string` — Express itself
 * guarantees the param is present whenever the route pattern matched.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw new Error(`Route parameter "${name}" is missing`);
  return value;
}
