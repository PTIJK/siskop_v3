import { Prisma } from "@prisma/client";
import { provinceName, type RegionRow } from "@siskop/types";
import { db } from "../../lib/db.js";

type Counts = { province: string | null; n: bigint }[];

/** Tenants, staff users and members per province. Tenants without a province form the last "Belum diisi" row. */
export async function getRegions(): Promise<RegionRow[]> {
  const [tenants, users, members] = await Promise.all([
    db.$queryRaw<Counts>(Prisma.sql`SELECT province, COUNT(*) AS n FROM "Tenant" GROUP BY province`),
    db.$queryRaw<Counts>(Prisma.sql`
      SELECT t.province, COUNT(*) AS n FROM "User" u JOIN "Tenant" t ON t.id = u."tenantId"
      WHERE u."isPlatformAdmin" = false GROUP BY t.province`),
    db.$queryRaw<Counts>(Prisma.sql`
      SELECT t.province, COUNT(*) AS n FROM "Member" m JOIN "Tenant" t ON t.id = m."tenantId" GROUP BY t.province`)
  ]);

  const rows = new Map<string | null, RegionRow>();
  const row = (code: string | null): RegionRow => {
    let r = rows.get(code);
    if (!r) {
      r = { code, name: provinceName(code), tenants: 0, users: 0, members: 0 };
      rows.set(code, r);
    }
    return r;
  };
  for (const t of tenants) row(t.province).tenants = Number(t.n);
  for (const u of users) row(u.province).users = Number(u.n);
  for (const m of members) row(m.province).members = Number(m.n);

  return [...rows.values()].sort((a, b) => {
    if (a.code === null) return 1;
    if (b.code === null) return -1;
    return b.members - a.members || b.users - a.users || b.tenants - a.tenants || a.name.localeCompare(b.name);
  });
}
