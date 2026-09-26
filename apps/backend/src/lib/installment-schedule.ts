import { Prisma } from "@prisma/client";
import { addDays, addMonths } from "date-fns";
import type { InstallmentFrequency } from "@siskop/types";
import { dateKey, nextOperatingDay, parseDateKey, addOperatingDays, type OperatingCalendar } from "./operating-calendar.js";

export interface ScheduleInstallment {
  seq: number;
  dueDate: Date;
  principalDue: Prisma.Decimal;
  interestDue: Prisma.Decimal;
}

const ROUNDING_UNIT = new Prisma.Decimal(500);

function dueDateFor(seq: number, frequency: InstallmentFrequency, disbursedAt: Date, cal: OperatingCalendar): Date {
  if (frequency === "DAILY") return addOperatingDays(disbursedAt, seq, cal);
  const calendarDate = frequency === "WEEKLY" ? addDays(disbursedAt, seq * 7) : addMonths(disbursedAt, seq);
  return nextOperatingDay(parseDateKey(dateKey(calendarDate)), cal);
}

/**
 * Splits `totalAmount` (principal + total interest, already computed by the
 * caller — see modules/loans/service.ts) into `count` installments due on
 * `frequency`-spaced operating days. Each installment is rounded UP to the
 * nearest Rp500 (D8); the last one absorbs the remainder so the sum is exact
 * to the cent. Principal/interest within an installment follow the loan's
 * overall principal:total ratio, same "plug the last one" rounding so both
 * columns also sum exactly.
 */
export function buildSchedule(input: {
  principal: Prisma.Decimal.Value;
  totalAmount: Prisma.Decimal.Value;
  frequency: InstallmentFrequency;
  count: number;
  disbursedAt: Date;
  calendar: OperatingCalendar;
}): ScheduleInstallment[] {
  const principal = new Prisma.Decimal(input.principal);
  const total = new Prisma.Decimal(input.totalAmount);
  const installmentAmount = total.div(input.count).div(ROUNDING_UNIT).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP).mul(ROUNDING_UNIT);

  const schedule: ScheduleInstallment[] = [];
  let principalSoFar = new Prisma.Decimal(0);
  let amountSoFar = new Prisma.Decimal(0);

  for (let seq = 1; seq <= input.count; seq++) {
    const isLast = seq === input.count;
    const amount = isLast ? total.sub(amountSoFar) : installmentAmount;
    const principalDue = isLast
      ? principal.sub(principalSoFar)
      : amount.mul(principal).div(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const interestDue = amount.sub(principalDue);

    schedule.push({
      seq,
      dueDate: dueDateFor(seq, input.frequency, input.disbursedAt, input.calendar),
      principalDue,
      interestDue
    });

    amountSoFar = amountSoFar.plus(amount);
    principalSoFar = principalSoFar.plus(principalDue);
  }

  return schedule;
}
