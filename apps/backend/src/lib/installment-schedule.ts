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
 * `frequency`-spaced operating days. The last installment absorbs whatever
 * remainder the split leaves, so the sum is always exact to the cent.
 * Principal/interest within an installment follow the loan's overall
 * principal:total ratio, same "plug the last one" rounding so both columns
 * also sum exactly.
 *
 * `roundToRp500` (D8) rounds every installment but the last UP to the
 * nearest Rp500 — for the koperasi pasar collector, who deals in physical
 * cash. Existing MONTHLY loans have no such constraint (bank-transfer-style
 * repayment) and must keep splitting to the exact cent, unchanged from
 * before F2, so this defaults to false.
 */
export function buildSchedule(input: {
  principal: Prisma.Decimal.Value;
  totalAmount: Prisma.Decimal.Value;
  frequency: InstallmentFrequency;
  count: number;
  disbursedAt: Date;
  calendar: OperatingCalendar;
  roundToRp500?: boolean;
}): ScheduleInstallment[] {
  const principal = new Prisma.Decimal(input.principal);
  const total = new Prisma.Decimal(input.totalAmount);
  const evenShare = total.div(input.count);
  const installmentAmount = input.roundToRp500
    ? evenShare.div(ROUNDING_UNIT).toDecimalPlaces(0, Prisma.Decimal.ROUND_UP).mul(ROUNDING_UNIT)
    : evenShare.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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
