import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { ErrorCode } from "@siskop/types";
import { getPublishedCatalog, toPublicCatalog } from "../../lib/pricing/catalog.js";
import { quote } from "../../lib/pricing/engine.js";
import { quoteRequestSchema } from "./schema.js";

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const quoteLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        error: { code: ErrorCode.RATE_LIMIT, message: "Terlalu banyak permintaan. Coba lagi sebentar." },
        meta: res.locals.meta
      });
    }
  });

/** Mounted at /api/public/pricing. No tenant data, no auth. */
export function publicPricingRoutes(): Router {
  const router = Router();

  router.get(
    "/",
    handle(async (_req, res) => {
      const catalog = toPublicCatalog(await getPublishedCatalog());
      res.set("Cache-Control", "public, max-age=60");
      res.json({ success: true, data: catalog, meta: res.locals.meta });
    })
  );

  router.post(
    "/quote",
    quoteLimiter(),
    handle(async (req, res) => {
      const selection = quoteRequestSchema.parse(req.body);
      const result = quote(selection, await getPublishedCatalog(), { publicOnly: true });
      res.set("Cache-Control", "no-store");
      res.json({ success: true, data: result, meta: res.locals.meta });
    })
  );

  return router;
}
