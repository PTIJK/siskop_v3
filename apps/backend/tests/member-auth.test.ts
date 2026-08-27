import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { defaultPasswordFromBirthDate } from "../src/modules/member-auth/service.js";
import { app, createMemberAs, createStaffSession, setupTenant, DEFAULT_MEMBER } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

// DEFAULT_MEMBER.birthDate is "1985-03-15" -> DDMMYYYY.
const DEFAULT_MEMBER_PASSWORD = "15031985";

describe("defaultPasswordFromBirthDate", () => {
  it("formats as DDMMYYYY using UTC date parts", () => {
    expect(defaultPasswordFromBirthDate(new Date("1985-03-15"))).toBe("15031985");
    expect(defaultPasswordFromBirthDate(new Date("2001-01-09"))).toBe("09012001");
  });
});

describe("POST /api/members/:id/portal-access", () => {
  it("activates portal access and returns the derived default password", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);

    const res = await request(app())
      .post(`/api/members/${member.id}/portal-access`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.defaultPassword).toBe(DEFAULT_MEMBER_PASSWORD);
    expect(res.body.data.mustChangePassword).toBe(true);
  });

  it("rejects a teller — members.update is not granted to that role", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .post(`/api/members/${member.id}/portal-access`)
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send();

    expect(res.status).toBe(403);
  });
});

describe("POST /api/member-auth/login", () => {
  it("rejects login before portal access has been activated", async () => {
    const admin = await setupTenant();
    await createMemberAs(admin.accessToken);

    const res = await request(app())
      .post("/api/member-auth/login")
      .set("Host", "demo.localhost")
      .send({ nik: DEFAULT_MEMBER.nik, password: DEFAULT_MEMBER_PASSWORD });

    expect(res.status).toBe(401);
  });

  it("logs the member in with the birthdate-derived password after staff activates access", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    await request(app())
      .post(`/api/members/${member.id}/portal-access`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send();

    const res = await request(app())
      .post("/api/member-auth/login")
      .set("Host", "demo.localhost")
      .send({ nik: DEFAULT_MEMBER.nik, password: DEFAULT_MEMBER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.member.fullName).toBe(DEFAULT_MEMBER.fullName);
    expect(res.body.data.member.mustChangePassword).toBe(true);
    expect(res.body.data.accessToken).toBeTypeOf("string");
  });

  it("sets a separate member refresh cookie, distinct from the staff one", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    await request(app())
      .post(`/api/members/${member.id}/portal-access`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send();

    const res = await request(app())
      .post("/api/member-auth/login")
      .set("Host", "demo.localhost")
      .send({ nik: DEFAULT_MEMBER.nik, password: DEFAULT_MEMBER_PASSWORD });

    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^siskop_member_refresh_token=/);
    expect(cookie).toMatch(/Path=\/api\/member-auth/i);
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  it("rejects the wrong password with 401", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    await request(app())
      .post(`/api/members/${member.id}/portal-access`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send();

    const res = await request(app())
      .post("/api/member-auth/login")
      .set("Host", "demo.localhost")
      .send({ nik: DEFAULT_MEMBER.nik, password: "salah" });

    expect(res.status).toBe(401);
  });

  it("scopes login by tenant even when two members in different tenants share a NIK", async () => {
    const adminA = await setupTenant({ slug: "demo" });
    const memberA = await createMemberAs(adminA.accessToken);
    await request(app())
      .post(`/api/members/${memberA.id}/portal-access`)
      .set("Authorization", `Bearer ${adminA.accessToken}`)
      .send();

    const adminB = await setupTenant({ slug: "barokah", registrationNo: "KOP-B", adminEmail: "admin@barokah.test" });
    const memberB = await createMemberAs(adminB.accessToken, { fullName: "Anggota Barokah" });
    await request(app())
      .post(`/api/members/${memberB.id}/portal-access`)
      .set("Authorization", `Bearer ${adminB.accessToken}`)
      .send();

    const res = await request(app())
      .post("/api/member-auth/login")
      .set("Host", "barokah.localhost")
      .send({ nik: DEFAULT_MEMBER.nik, password: DEFAULT_MEMBER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.member.fullName).toBe("Anggota Barokah");
  });
});

async function activateAndLogin(adminAccessToken: string, memberId: string, host = "demo.localhost") {
  await request(app())
    .post(`/api/members/${memberId}/portal-access`)
    .set("Authorization", `Bearer ${adminAccessToken}`)
    .send();

  const login = await request(app())
    .post("/api/member-auth/login")
    .set("Host", host)
    .send({ nik: DEFAULT_MEMBER.nik, password: DEFAULT_MEMBER_PASSWORD });

  return login.body.data.accessToken as string;
}

describe("PUT /api/member-auth/me/password", () => {
  it("changes the password and clears mustChangePassword", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const accessToken = await activateAndLogin(admin.accessToken, member.id);

    const changeRes = await request(app())
      .put("/api/member-auth/me/password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: DEFAULT_MEMBER_PASSWORD, newPassword: "passwordBaru123" });

    expect(changeRes.status).toBe(200);

    const meRes = await request(app())
      .get("/api/member-auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(meRes.body.data.mustChangePassword).toBe(false);

    const oldLogin = await request(app())
      .post("/api/member-auth/login")
      .set("Host", "demo.localhost")
      .send({ nik: DEFAULT_MEMBER.nik, password: DEFAULT_MEMBER_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app())
      .post("/api/member-auth/login")
      .set("Host", "demo.localhost")
      .send({ nik: DEFAULT_MEMBER.nik, password: "passwordBaru123" });
    expect(newLogin.status).toBe(200);
  });
});

describe("member/staff session isolation", () => {
  it("rejects a member token on a staff-only route", async () => {
    const admin = await setupTenant();
    const member = await createMemberAs(admin.accessToken);
    const accessToken = await activateAndLogin(admin.accessToken, member.id);

    const res = await request(app())
      .get("/api/members")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(401);
  });

  it("rejects a staff token on a member-only route", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .get("/api/member/dashboard")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(401);
  });
});
