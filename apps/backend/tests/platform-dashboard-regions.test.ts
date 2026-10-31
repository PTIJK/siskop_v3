import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { getRegions } from "../src/modules/platform-dashboard/regions.js";
import { createMemberAs, setupTenant } from "./helpers.js";

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("getRegions", () => {
  it("groups tenants, staff users and members by province, with unset last", async () => {
    const jatim = await setupTenant();
    await db.tenant.update({ where: { id: jatim.user.tenantId }, data: { province: "35", city: "Surabaya" } });
    await createMemberAs(jatim.accessToken);
    await setupTenant({ slug: "tanpa", registrationNo: "KOP-TANPA" });

    const rows = await getRegions();

    expect(rows).toEqual([
      { code: "35", name: "Jawa Timur", tenants: 1, users: 1, members: 1 },
      { code: null, name: "Belum diisi", tenants: 1, users: 1, members: 0 }
    ]);
  });

  it("falls back to the raw code for a province not in the list", async () => {
    const s = await setupTenant();
    await db.tenant.update({ where: { id: s.user.tenantId }, data: { province: "99" } });

    const rows = await getRegions();

    expect(rows[0]).toMatchObject({ code: "99", name: "99" });
  });

  it("returns an empty list when there are no tenants", async () => {
    expect(await getRegions()).toEqual([]);
  });
});
