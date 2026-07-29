export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  RATE_LIMIT: "RATE_LIMIT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // Ported KSP business-rule codes (Members/Savings/Loans) — each maps to the
  // 4xx status closest to the old system's behavior; NOT_FOUND/CONFLICT above
  // are reused (with a specific message) for entity-not-found/duplicate cases
  // rather than adding one code per entity.
  NIK_EXISTS: "NIK_EXISTS",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  CANNOT_WITHDRAW_POKOK: "CANNOT_WITHDRAW_POKOK",
  MEMBER_HAS_NO_POKOK_SAVING: "MEMBER_HAS_NO_POKOK_SAVING",
  TERM_EXCEEDS_MAX: "TERM_EXCEEDS_MAX",
  LOAN_NOT_ACTIVE: "LOAN_NOT_ACTIVE",
  INVALID_FILE_TYPE: "INVALID_FILE_TYPE",
  JOURNAL_ENTRY_UNBALANCED: "JOURNAL_ENTRY_UNBALANCED",
  // Phase-2 SaaS packaging — a tenant's SubscriptionPackage gates these.
  FEATURE_NOT_ENTITLED: "FEATURE_NOT_ENTITLED",
  PACKAGE_LIMIT_EXCEEDED: "PACKAGE_LIMIT_EXCEEDED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  // page/limit/total are present on paginated list endpoints (Members/
  // Savings/Loans), merged alongside timestamp/requestId in the same object.
  meta: { timestamp: string; requestId: string; page?: number; limit?: number; total?: number };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
