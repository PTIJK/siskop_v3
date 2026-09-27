import type { Account } from "./accounting.js";

export interface ExpenseEntry {
  id: string;
  entryDate: string;
  description: string;
  amount: string;
  debitAccountId: string;
  debitAccountName: string;
  creditAccountId: string;
  creditAccountName: string;
  unitId: string | null;
  unitName: string | null;
  createdAt: string;
}

export interface CreateExpenseRequest {
  entryDate: string;
  description: string;
  amount: number;
  debitAccountId: string;
  creditAccountId: string;
  unitId?: string;
}

export interface ExpenseAccountsResponse {
  /** BEBAN-category, active accounts — the debit side. */
  debitAccounts: Account[];
  /** Cash-equivalent, active accounts — the credit side. */
  creditAccounts: Account[];
}
