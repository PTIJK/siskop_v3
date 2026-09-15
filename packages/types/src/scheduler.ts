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
}

export interface SchedulerStatus {
  version: 1;
  revision: string;
  daily: boolean;
  identityRecovery: boolean;
}
