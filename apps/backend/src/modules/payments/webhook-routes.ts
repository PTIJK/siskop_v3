import { Router } from "express";
import { ErrorCode, type ApiResponse } from "@siskop/types";
import { getAdapter } from "../../lib/payments/adapters.js";
import { notFound } from "../../lib/errors.js";

/**
 * Where a payment gateway will post its events. No gateway is connected yet,
 * so every known provider answers 501 and nothing is read, verified or stored:
 * an unauthenticated request must never be able to mark an invoice paid.
 * When an adapter's verifyWebhook is real, this route should use the raw body,
 * check the signature, drop replays through WebhookEvent, then call confirmPayment.
 */
export function paymentWebhookRoutes(): Router {
  const router = Router();
  router.post("/:provider", (req, res, next) => {
    const provider = req.params.provider ?? "";
    if (!getAdapter(provider)) return next(notFound("Unknown payment provider"));
    res.status(501).json({
      success: false,
      error: { code: ErrorCode.NOT_IMPLEMENTED, message: `Payment provider "${provider}" is not connected yet` },
      meta: res.locals.meta
    } satisfies ApiResponse<never>);
  });
  return router;
}
