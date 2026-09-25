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
}

/** Daily Permenkop UKM 2/2024 Pasal 12 modal-disetor audit-threshold reminder. */
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
