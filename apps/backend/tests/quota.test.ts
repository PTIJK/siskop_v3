import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { clearEntitlementCache, getUsage } from "../src/lib/pricing/entitlements.js";
import { inviteMembership, acceptInvitation } from "../src/modules/tenant-access/invitations.js";
import { app, createMemberAs, DEFAULT_MEMBER, setupTenant } from "./helpers.js";
import { attachSubscription, resetCatalog, seedCatalog } from "./billing-fixture.js";

vi.mock("../src/modules/onboarding/firebase.js", () => ({
  verifyFirebaseIdentity: vi.fn(async (uid: string) => ({ uid, email: "invitee@quota.test", provider: "google.com", authTime: Math.floor(Date.now() / 1000), emailVerified: true })),
  assertFirebaseSession: vi.fn(async () => {})
}));

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  await seedCatalog();
  clearEntitlementCache();
  vi.stubEnv("PRICING_V2_ENFORCEMENT", "on");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.tenant.deleteMany({});
  await resetCatalog();
});

/** A koperasi on Enterprise whose limits are overridden, so a quota can be hit in a few calls. */
async function tenantWithLimits(limitOverrides: Record<string, number | null>) {
  const session = await setupTenant();
  await attachSubscription(session.user.tenantId, { packageCode: "enterprise", limitOverrides });
  const auth = { Authorization: `Bearer ${session.accessToken}` };
  return {
    ...session,
    tenantId: session.user.tenantId,
    get: (path: string) => request(app()).get(path).set(auth),
    post: (path: string, body: object) => request(app()).post(path).set(auth).send(body),
    put: (path: string, body: object) => request(app()).put(path).set(auth).send(body),
    del: (path: string) => request(app()).delete(path).set(auth)
  };
}

const member = (n: number) => ({ ...DEFAULT_MEMBER, nik: `31712345678900${String(n).padStart(2, "0")}`, fullName: `Anggota ${n}` });
const QUOTA = { code: "QUOTA_EXCEEDED", status: 403 };

describe("members", () => {
  it("allows creating up to the limit and then answers QUOTA_EXCEEDED with the numbers", async () => {
    const t = await tenantWithLimits({ members: 2 });
    expect((await t.post("/api/members", member(1))).status).toBe(201);
    expect((await t.post("/api/members", member(2))).status).toBe(201);

    const res = await t.post("/api/members", member(3));

    expect(res.status).toBe(QUOTA.status);
    expect(res.body.error).toMatchObject({ code: QUOTA.code, details: { item: "MEMBERS", limit: 2, used: 2 } });
    expect((await getUsage(t.tenantId)).members).toBe(2);
  });

  it("counts only active members: deactivating one frees a slot", async () => {
    const t = await tenantWithLimits({ members: 1 });
    const first = await createMemberAs(t.accessToken, member(1));
    expect((await t.post("/api/members", member(2))).status).toBe(403);
    expect((await t.del(`/api/members/${first.id}`)).status).toBe(200);
    expect((await t.post("/api/members", member(2))).status).toBe(201);
  });

  it("never lets two simultaneous creates take the last slot", async () => {
    const t = await tenantWithLimits({ members: 1 });
    const results = await Promise.all([1, 2, 3, 4].map((n) => t.post("/api/members", member(n))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 403)).toHaveLength(3);
    expect((await getUsage(t.tenantId)).members).toBe(1);
  });

  it("blocks approving a self-registration request that would exceed the limit", async () => {
    const t = await tenantWithLimits({ members: 1 });
    await createMemberAs(t.accessToken, member(1));
    const pending = await db.memberRegistrationRequest.create({
      data: { tenantId: t.tenantId, fullName: "Calon", nik: "3171234567890077", address: "Jl. B", birthPlace: "Jakarta", birthDate: new Date("1990-01-01"), occupation: "Guru" }
    });
    const res = await t.post(`/api/members/registration-requests/${pending.id}/approve`, {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(QUOTA.code);
  });

  it("leaves existing members alone when a koperasi is already over its limit: only new ones are blocked", async () => {
    const t = await tenantWithLimits({ members: 5 });
    for (const n of [1, 2, 3]) await createMemberAs(t.accessToken, member(n));
    await db.tenantSubscription.updateMany({ where: { tenantId: t.tenantId }, data: { limitOverrides: { members: 1 } } });
    clearEntitlementCache(t.tenantId);

    const list = await t.get("/api/members");
    expect(list.status).toBe(200);
    expect(list.body.data.items ?? list.body.data).toHaveLength(3);
    expect((await t.post("/api/members", member(4))).status).toBe(403);
    expect((await getUsage(t.tenantId)).members).toBe(3);
  });

  it("does not enforce a null (unlimited) limit", async () => {
    const t = await tenantWithLimits({ members: null });
    for (const n of [1, 2, 3]) expect((await t.post("/api/members", member(n))).status).toBe(201);
  });

  it("does not enforce anything while the flag is off or in shadow mode", async () => {
    const t = await tenantWithLimits({ members: 1 });
    await t.post("/api/members", member(1));
    vi.stubEnv("PRICING_V2_ENFORCEMENT", "off");
    expect((await t.post("/api/members", member(2))).status).toBe(201);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("PRICING_V2_ENFORCEMENT", "shadow");
    expect((await t.post("/api/members", member(3))).status).toBe(201);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("PRICING_SHADOW QUOTA_EXCEEDED"))).toBe(true);
    warn.mockRestore();
  });
});

describe("users", () => {
  async function newUserBody(t: Awaited<ReturnType<typeof tenantWithLimits>>, email: string) {
    const role = await db.role.findFirstOrThrow({ where: { tenantId: t.tenantId, name: "Teller" } });
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    return { name: "Staf", email, password: "rahasia123", roleId: role.id, unitIds: [unit.id] };
  }

  it("counts the administrator and blocks the user that would pass the limit", async () => {
    const t = await tenantWithLimits({ users: 2 });
    expect((await t.post("/api/users", await newUserBody(t, "a@quota.test"))).status).toBe(201);
    const res = await t.post("/api/users", await newUserBody(t, "b@quota.test"));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: QUOTA.code, details: { item: "USERS", limit: 2, used: 2 } });
    expect(await db.user.count({ where: { tenantId: t.tenantId, email: "b@quota.test" } })).toBe(0);
  });

  it("blocks reactivating a user when the limit is full, and allows it when there is room", async () => {
    const t = await tenantWithLimits({ users: 1 });
    const body = await newUserBody(t, "dormant@quota.test");
    const dormant = await db.user.create({ data: { tenantId: t.tenantId, roleId: body.roleId, email: body.email, name: "Dormant", isActive: false } });

    const blocked = await t.put(`/api/users/${dormant.id}`, { isActive: true });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe(QUOTA.code);

    await db.tenantSubscription.updateMany({ where: { tenantId: t.tenantId }, data: { limitOverrides: { users: 2 } } });
    clearEntitlementCache(t.tenantId);
    expect((await t.put(`/api/users/${dormant.id}`, { isActive: true })).status).toBe(200);
  });

  it("editing a user who is already active is never blocked", async () => {
    const t = await tenantWithLimits({ users: 1 });
    expect((await t.put(`/api/users/${t.user.id}`, { name: "Nama Baru" })).status).toBe(200);
  });
});

describe("saving and loan types", () => {
  it("blocks a saving type past the limit", async () => {
    const t = await tenantWithLimits({ savingTypes: 1 });
    const body = { name: "Simpanan", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" };
    const used = (await getUsage(t.tenantId)).savingTypes;
    await db.tenantSubscription.updateMany({ where: { tenantId: t.tenantId }, data: { limitOverrides: { savingTypes: used } } });
    clearEntitlementCache(t.tenantId);
    const res = await t.post("/api/savings/configs", body);
    expect(res.status).toBe(403);
    expect(res.body.error.details).toMatchObject({ item: "SAVING_TYPES", limit: used, used });
  });

  it("allows a saving type while there is room", async () => {
    const t = await tenantWithLimits({ savingTypes: 10 });
    const res = await t.post("/api/savings/configs", { name: "Simpanan", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" });
    expect(res.status).toBe(201);
  });

  it("blocks a loan type past the limit", async () => {
    const t = await tenantWithLimits({ loanTypes: 1 });
    const used = (await getUsage(t.tenantId)).loanTypes;
    await db.tenantSubscription.updateMany({ where: { tenantId: t.tenantId }, data: { limitOverrides: { loanTypes: used } } });
    clearEntitlementCache(t.tenantId);
    const res = await t.post("/api/loans/configs", { name: "KUR", type: "KONVENSIONAL", rateType: "BUNGA", rate: 12, maxTermMonths: 36 });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toMatchObject({ item: "LOAN_TYPES", limit: used });
  });
});

describe("invitations", () => {
  async function invite(t: Awaited<ReturnType<typeof tenantWithLimits>>) {
    process.env.TENANT_SELECTION_ENABLED = "true";
    const role = await db.role.findFirstOrThrow({ where: { tenantId: t.tenantId, name: "Teller" } });
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    const invited = await db.user.create({ data: { tenantId: t.tenantId, roleId: role.id, email: "invitee@quota.test", name: "Tamu", isActive: false, unitAssignments: { create: [{ unitId: unit.id }] } } });
    const invitation = await inviteMembership(t.tenantId, invited.id);
    return { invited, token: new URLSearchParams(new URL(invitation.invitationUrl).hash.slice(1)).get("token")! };
  }

  it("accepting an invitation takes a seat: blocked when the limit is full, allowed when there is room", async () => {
    const full = await tenantWithLimits({ users: 1 });
    const a = await invite(full);
    await expect(acceptInvitation(a.token, "invitee-uid")).rejects.toThrow(/QUOTA_EXCEEDED/);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.invited.id, tenantId: full.tenantId } })).isActive).toBe(false);
  });
});
