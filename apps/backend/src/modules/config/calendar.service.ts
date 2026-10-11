import { Prisma } from "@prisma/client";
import type { OperatingDaysConfig, TenantHoliday } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { dateKey, parseDateKey } from "../../lib/operating-calendar.js";
import { recordAudit } from "../audit-log/service.js";
import type {
  CreateHolidayInput,
  ImportHolidaysInput,
  ListHolidaysQuery,
  UpdateOperatingDaysInput
} from "./schema.js";

function toDto(h: { id: string; date: Date; name: string }): TenantHoliday {
  return { id: h.id, date: dateKey(h.date), name: h.name };
}

export async function listHolidays(tenantId: string, query: ListHolidaysQuery): Promise<TenantHoliday[]> {
  const rows = await db.tenantHoliday.findMany({
    where: {
      tenantId,
      ...(query.year
        ? { date: { gte: parseDateKey(`${query.year}-01-01`), lte: parseDateKey(`${query.year}-12-31`) } }
        : {})
    },
    orderBy: { date: "asc" }
  });
  return rows.map(toDto);
}

export async function createHoliday(tenantId: string, data: CreateHolidayInput): Promise<TenantHoliday> {
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.tenantHoliday.create({
        data: { tenantId, date: parseDateKey(data.date), name: data.name }
      });
      await recordAudit(tx, {
        action: "holiday.create",
        entityType: "TenantHoliday",
        entityId: created.id,
        after: { date: data.date, name: data.name }
      });
      return toDto(created);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict(`Tanggal ${data.date} sudah terdaftar sebagai hari libur`);
    }
    throw err;
  }
}

/** Adds every holiday whose date isn't already on the tenant's list; existing dates are left untouched. */
export async function importHolidays(
  tenantId: string,
  data: ImportHolidaysInput
): Promise<{ created: number; skipped: number }> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.tenantHoliday.createMany({
      data: data.holidays.map((h) => ({ tenantId, date: parseDateKey(h.date), name: h.name })),
      skipDuplicates: true
    });
    await recordAudit(tx, {
      action: "holiday.import",
      entityType: "TenantHoliday",
      after: { created: count, dates: data.holidays.map((h) => h.date) }
    });
    return { created: count, skipped: data.holidays.length - count };
  });
}

export async function deleteHoliday(tenantId: string, id: string): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const holiday = await tx.tenantHoliday.findFirst({ where: { id, tenantId } });
    if (!holiday) throw notFound("Hari libur tidak ditemukan");
    await tx.tenantHoliday.delete({ where: { id, tenantId } });
    await recordAudit(tx, {
      action: "holiday.delete",
      entityType: "TenantHoliday",
      entityId: id,
      before: { date: dateKey(holiday.date), name: holiday.name }
    });
    return { id };
  });
}

export async function getOperatingDays(tenantId: string): Promise<OperatingDaysConfig> {
  return db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { closedWeekdays: true } });
}

export async function updateOperatingDays(
  tenantId: string,
  data: UpdateOperatingDaysInput
): Promise<OperatingDaysConfig> {
  return db.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { closedWeekdays: true } });
    const updated = await tx.tenant.update({
      where: { id: tenantId },
      data: { closedWeekdays: data.closedWeekdays },
      select: { closedWeekdays: true }
    });
    await recordAudit(tx, {
      action: "operating_days.update",
      entityType: "Tenant",
      entityId: tenantId,
      before,
      after: updated
    });
    return updated;
  });
}
