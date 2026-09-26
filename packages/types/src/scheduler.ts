export interface SavingInterestAccrualResult {
  checked: number;
  posted: number;
  skipped: number;
  failed: number;
}

export interface DailySchedulerResult {
  date: string;
  savingsInterest: SavingInterestAccrualResult;
  loanKol: { checked: number; failed: number };
  auditThreshold: AuditThresholdCheckResult;
  auditLogPurge: AuditLogPurgeResult;
}

/** 90-day retention sweep for the user-activity AuditLog — see modules/audit-log/service.ts#purgeStaleAuditLogs. */
export interface AuditLogPurgeResult {
  deleted: number;
  failed: number;
}

/** Daily Permenkop UKM 2/2024 Pasal 12 audit-threshold reminder, judged on ledger Modal Sendiri. */
export interface AuditThresholdCheckResult {
  checked: number;
  notified: number;
  failed: number;
}

export interface SchedulerStatus {
  version: 1;
  revision: string;
  daily: boolean;
  identityRecovery: boolean;
}
