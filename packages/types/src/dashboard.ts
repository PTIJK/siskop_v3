export interface DashboardSummary {
  totalSavings: string;
  totalActiveLoans: string;
  memberCount: number;
  monthlyPayments: string;
  /** Count of ACTIVE loans in the worst KOL bucket (MACET) only. */
  overdueCount: number;
}

export interface ChartQuery {
  months?: number;
}

export interface ChartPoint {
  month: string;
  value: string;
}
