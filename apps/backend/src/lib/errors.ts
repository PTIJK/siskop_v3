import { ErrorCode } from "@siskop/types";

const STATUS: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.RATE_LIMIT]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  // Ported KSP business-rule codes — see packages/types/src/api.ts.
  [ErrorCode.NIK_EXISTS]: 409,
  [ErrorCode.INSUFFICIENT_BALANCE]: 422,
  [ErrorCode.CANNOT_WITHDRAW_POKOK]: 422,
  [ErrorCode.MEMBER_HAS_NO_POKOK_SAVING]: 422,
  [ErrorCode.TERM_EXCEEDS_MAX]: 422,
  [ErrorCode.LOAN_NOT_ACTIVE]: 422,
  [ErrorCode.INVALID_FILE_TYPE]: 422,
  [ErrorCode.JOURNAL_ENTRY_UNBALANCED]: 500,
  [ErrorCode.FEATURE_NOT_ENTITLED]: 403,
  [ErrorCode.PACKAGE_LIMIT_EXCEEDED]: 422,
  [ErrorCode.MEMBER_HAS_NO_ACTIVE_SAVING]: 422,
  [ErrorCode.MEMBER_CREDIT_LIMIT_EXCEEDED]: 422
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

export function forbidden(message = "Forbidden"): AppError {
  return new AppError(ErrorCode.FORBIDDEN, message);
}

export function notFound(message = "Not found"): AppError {
  return new AppError(ErrorCode.NOT_FOUND, message);
}

export function conflict(message: string): AppError {
  return new AppError(ErrorCode.CONFLICT, message);
}

export function validationError(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, details);
}

export function featureNotEntitled(message: string): AppError {
  return new AppError(ErrorCode.FEATURE_NOT_ENTITLED, message);
}

export function packageLimitExceeded(message: string): AppError {
  return new AppError(ErrorCode.PACKAGE_LIMIT_EXCEEDED, message);
}
