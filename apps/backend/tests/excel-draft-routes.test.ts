import ExcelJS from "exceljs";
import request from "supertest";
import { expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { testDatabaseUrl } from "./database-isolation.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

it("persists Excel drafts for authorized tenant admins and keeps other tenants and live data out", async () => {
  testDatabaseUrl(process.env.DATABASE_URL ?? "");
  const slug = "excel-draft-admin-test";
  const admin = await setupTenant({ slug, registrationNo: slug, adminEmail: slug + "@example.test" });
  const otherSlug = "excel-draft-other-test";
  const other = await setupTenant({ slug: otherSlug, registrationNo: otherSlug, adminEmail: otherSlug + "@example.test" });
  const tenantId = admin.user.tenantId;
  try {
    const staff = await createStaffSession(tenantId, slug, "Manager", "excel-draft-staff@example.test");
    const server = app();
    const path = "/api/excel-imports";
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Anggota").addRows([["Nama", "NIK"], ["Anggota uji"]]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const submit = (token: string) => request(server).post(path).auth(token, { type: "bearer" }).attach("file", bytes, "koperasi.xlsx");
    expect((await request(server).get(path)).status).toBe(401);
    expect((await submit(staff.accessToken)).status).toBe(403);
    const saved = await submit(admin.accessToken);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.counts.anggota).toBe(1);
    expect((await submit(admin.accessToken)).body.data.id).toBe(saved.body.data.id);
    const url = path + "/" + saved.body.data.id;
    const reopened = await request(app()).get(url).auth(admin.accessToken, { type: "bearer" });
    expect(reopened.status).toBe(200);
    expect(reopened.headers["cache-control"]).toContain("no-store");
    expect(reopened.body.data.records.anggota[0].title).toBe("Anggota uji");
    const list = await request(app()).get(path).auth(admin.accessToken, { type: "bearer" });
    expect(list.body.data.drafts).toEqual([saved.body.data]);
    expect((await request(server).get(url).auth(other.accessToken, { type: "bearer" })).status).toBe(404);
    expect((await request(server).get(path).auth(other.accessToken, { type: "bearer" })).body.data.drafts).toEqual([]);
    expect(await db.member.count({ where: { tenantId } })).toBe(0);
    expect(await db.saving.count({ where: { tenantId } })).toBe(0);
    expect(await db.loan.count({ where: { tenantId } })).toBe(0);
  } finally {
    await db.tenant.deleteMany({ where: { id: { in: [tenantId, other.user.tenantId] } } });
  }
});
