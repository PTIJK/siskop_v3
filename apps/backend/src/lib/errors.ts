import { ErrorCode } from "@siskop/types";

const STATUS: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMIT]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500
};

/**
 * An error a route may safely report to the client. Anything thrown that is
 * *not* an AppError is treated as an internal error and its message withheld,
 * so an accidental leak (a Prisma message naming a column, say) cannot escape
 * by default.
 *
 * The message is prefixed with the code so service-level tests can assert on
 * the failure mode without importing the HTTP layer.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(`${code}: ${message}`);
    this.name = "AppError";
    this.status = STATUS[code];
  }

  /** The message without the code prefix, for the wire. */
  get clientMessage(): string {
    return this.message.slice(this.code.length + 2);
  }
}

export function unauthorized(message = "Invalid credentials"): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, message);
}

export function conflict(message: string): AppError {
  return new AppError(ErrorCode.CONFLICT, message);
}

export function validationError(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, details);
}
