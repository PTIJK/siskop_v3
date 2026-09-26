/** A tenant's own non-collection day. `date` is a calendar date, `YYYY-MM-DD`. */
export interface TenantHoliday {
  id: string;
  date: string;
  name: string;
}

export interface CreateHolidayRequest {
  date: string;
  name: string;
}

export interface ImportHolidaysRequest {
  holidays: CreateHolidayRequest[];
}

export interface ImportHolidaysResult {
  created: number;
  skipped: number;
}

/** Weekdays with no collection: 0 = Sunday … 6 = Saturday. Sunday-only by default. */
export interface OperatingDaysConfig {
  closedWeekdays: number[];
}
