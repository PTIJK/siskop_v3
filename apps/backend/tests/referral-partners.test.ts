import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { buildPartnerApprovedEmail, buildPartnerReceivedEmail, buildPartnerRejectedEmail } from "../src/lib/referrals/emails.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { resetCatalog, seedCatalog } from "./billing-fixture.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";
import { cleanReferrals, makePartner } from "./referral-fixture.js";

let token: string;
let adminId: string;

const application = (over: Record<string, unknown> = {}) => ({
  name: "Budi Santoso",
  email: "Budi@Mitra.Example",
  phone: "0812-3456-7890",
  city: "Surabaya",
  province: "Jawa Timur",
  ktpNo: "3578010101900001",
  bankName: "BCA",
  bankAccountNo: "1234567890",
  bankAccountName: "Budi Santoso",
  salesPlan: "Jaringan koperasi di Jawa Timur",
  termsVersion: "2026-11",
  acceptTerms: true,
  ...over
});
const apply = (body: Record<string, unknown> = application()) => request(app()).post("/api/partners/apply").send(body);
const partners = () => withoutTenantScope(async () => db.referralPartner.findMany({ orderBy: { createdAt: "asc" } }));
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
const admin = {
  get: (path = "") => auth(request(app()).get(`/api/platform/partners${path}`)),
  post: (path: string, body: unknown = {}) => auth(request(app()).post(`/api/platform/partners${path}`)).send(body as object)
};
const audit = (action: string) => db.pricingAuditLog.findMany({ where: { entity: "referral_partner", action } });

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await cleanReferrals();
  await db.tenant.deleteMany({});
  await seedCatalog();
  const session = await createPlatformAdminSession();
  token = session.accessToken;
  adminId = session.user.id;
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanReferrals();
  await db.tenant.deleteMany({});
  await resetCatalog();
});
afterAll(() => db.$disconnect());

describe("POST /api/partners/apply", () => {
  it("creates a PENDING partner with no code, normalised contact data and the program defaults", async () => {
    const res = await apply();
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ received: true });
    const [p] = await partners();
    expect(p).toMatchObject({
      status: "PENDING",
      source: "APPLICATION",
      code: null,
      email: "budi@mitra.example",
      phone: "081234567890",
      termsVersion: "2026-11",
      commissionMonths: 12
    });
    expect(p!.commissionRate.toString()).toBe("0.2");
    expect(p!.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it("accepts +62 phones and stores them as 08…", async () => {
    await apply(application({ phone: "+62 812 3456 7890" }));
    expect((await partners())[0]!.phone).toBe("081234567890");
  });

  it("answers a duplicate email or phone the same way without creating a second row or revealing status", async () => {
    await apply();
    const sameEmail = await apply(application({ email: "budi@mitra.example", phone: "081200000001" }));
    const samePhone = await apply(application({ email: "lain@mitra.example" }));
    expect(sameEmail.status).toBe(201);
    expect(samePhone.status).toBe(sameEmail.status);
    expect(samePhone.body.data).toEqual(sameEmail.body.data);
    expect(await partners()).toHaveLength(1);
  });

  it("lets a rejected applicant re-apply only after 30 days", async () => {
    await apply();
    const [p] = await partners();
    await withoutTenantScope(async () => db.referralPartner.update({ where: { id: p!.id }, data: { status: "REJECTED", reviewedAt: new Date() } }));
    await apply();
    expect(await partners()).toHaveLength(1);
    await withoutTenantScope(async () =>
      db.referralPartner.update({ where: { id: p!.id }, data: { reviewedAt: new Date(Date.now() - 31 * 86_400_000) } })
    );
    await apply();
    expect(await partners()).toHaveLength(2);
  });

  it.each([
    ["a filled honeypot", { website: "http://spam.example" }],
    ["a short KTP", { ktpNo: "123" }],
    ["a non-numeric KTP", { ktpNo: "35780101019000AB" }],
    ["a bad phone", { phone: "12345" }],
    ["a bad email", { email: "nope" }],
    ["terms not accepted", { acceptTerms: false }],
    ["an unknown field", { commissionRate: "0.5" }]
  ])("rejects %s", async (_label, over) => {
    const res = await apply(application(over));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await partners()).toHaveLength(0);
  });

  it("requires JSON", async () => {
    expect((await request(app()).post("/api/partners/apply").type("form").send("name=x")).status).toBe(403);
  });
});

describe("access to /api/platform/partners", () => {
  it("is closed to anonymous callers and tenant roles", async () => {
    const tenant = await setupTenant({ slug: "biasa", registrationNo: "KOP-BIASA", adminEmail: "biasa@demo.test" });
    expect((await request(app()).get("/api/platform/partners")).status).toBe(401);
    for (const path of ["", "/x", "/x/approve", "/x/reject"]) {
      const method = path.endsWith("approve") || path.endsWith("reject") ? "post" : "get";
      const res = await request(app())[method](`/api/platform/partners${path}`).set("Authorization", `Bearer ${tenant.accessToken}`).send({});
      expect(res.status).toBe(403);
    }
  });
});

describe("GET /api/platform/partners", () => {
  it("lists newest first, pending applications queue first, and filters by status", async () => {
    await makePartner({ status: "ACTIVE" });
    await apply();
    const all = await admin.get();
    expect(all.status).toBe(200);
    expect(all.body.data.map((p: { status: string }) => p.status)).toEqual(["PENDING", "ACTIVE"]);
    const pending = await admin.get("?status=PENDING");
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0]).toMatchObject({ code: null, referredTenants: 0, commissionOutstanding: "0.00" });
    expect((await admin.get("?status=NOPE")).status).toBe(422);
  });

  it("returns the full submitted application on the detail route", async () => {
    await apply();
    const [p] = await partners();
    const res = await admin.get(`/${p!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ktpNo: "3578010101900001", bankName: "BCA", salesPlan: "Jaringan koperasi di Jawa Timur", referrals: [], commissions: [], payouts: [] });
    expect((await admin.get("/missing")).status).toBe(404);
  });
});

describe("POST /api/platform/partners/:id/approve", () => {
  const pendingId = async () => {
    await apply();
    return (await partners())[0]!.id;
  };

  it("activates the partner, generates a NEX- code, records the reviewer and audits it", async () => {
    const id = await pendingId();
    const res = await admin.post(`/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data.code).toMatch(/^NEX-[A-Z0-9]{6}$/);
    const [p] = await partners();
    expect(p).toMatchObject({ status: "ACTIVE", reviewedById: adminId });
    expect(p!.reviewedAt).toBeInstanceOf(Date);
    expect(await audit("APPROVED")).toHaveLength(1);
  });

  it("makes the new code usable at registration", async () => {
    const id = await pendingId();
    const code = (await admin.post(`/${id}/approve`)).body.data.code as string;
    const check = await request(app()).get(`/api/onboarding/referral/${code}`);
    expect(check.body.data).toEqual({ valid: true, partnerName: "Budi Santoso" });
  });

  it("applies a rate, months and vanity code override", async () => {
    const id = await pendingId();
    const res = await admin.post(`/${id}/approve`, { code: "budi", commissionRate: "0.3", commissionMonths: 6 });
    expect(res.body.data).toMatchObject({ code: "NEX-BUDI", commissionRate: "0.3000", commissionMonths: 6 });
  });

  it("refuses a second approval, and approving a non-pending partner", async () => {
    const id = await pendingId();
    expect((await admin.post(`/${id}/approve`)).status).toBe(200);
    expect((await admin.post(`/${id}/approve`)).status).toBe(409);
    const active = await makePartner({ status: "ACTIVE" });
    expect((await admin.post(`/${active.id}/approve`)).status).toBe(409);
  });

  it("rejects an out-of-range rate or months, a malformed code, and a code already taken", async () => {
    const id = await pendingId();
    for (const body of [{ commissionRate: "0.51" }, { commissionRate: "-0.1" }, { commissionMonths: 0 }, { commissionMonths: 61 }, { code: "NEX-!!" }]) {
      expect((await admin.post(`/${id}/approve`, body)).status).toBe(422);
    }
    await makePartner({ code: "NEX-TAKEN1" });
    expect((await admin.post(`/${id}/approve`, { code: "NEX-TAKEN1" })).status).toBe(409);
    expect((await partners()).find((p) => p.id === id)!.status).toBe("PENDING");
  });

  it("returns 404 for an unknown partner", async () => {
    expect((await admin.post("/nope/approve")).status).toBe(404);
  });
});

describe("POST /api/platform/partners/:id/reject", () => {
  it("stores the reason, keeps the code empty and audits it", async () => {
    await apply();
    const [p] = await partners();
    const res = await admin.post(`/${p!.id}/reject`, { reason: "KTP tidak sesuai" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "REJECTED", rejectReason: "KTP tidak sesuai", code: null });
    expect(await audit("REJECTED")).toHaveLength(1);
  });

  it("requires a reason and a pending partner", async () => {
    await apply();
    const [p] = await partners();
    expect((await admin.post(`/${p!.id}/reject`, {})).status).toBe(422);
    expect((await admin.post(`/${p!.id}/reject`, { reason: " " })).status).toBe(422);
    await admin.post(`/${p!.id}/reject`, { reason: "Tidak lengkap" });
    expect((await admin.post(`/${p!.id}/reject`, { reason: "Lagi" })).status).toBe(409);
  });

  it("keeps a REJECTED partner's code unusable at registration", async () => {
    await apply();
    const [p] = await partners();
    await admin.post(`/${p!.id}/reject`, { reason: "Tidak lengkap" });
    const check = await request(app()).get("/api/onboarding/referral/NEX-BUDI");
    expect(check.body.data.valid).toBe(false);
  });
});

describe("partner emails", () => {
  const from = "SISKOP <noreply@siskop.test>";
  it("confirms receipt without promising approval", () => {
    const mail = buildPartnerReceivedEmail({ to: "a@b.test", name: "Budi" }, from);
    expect(mail.to).toEqual(["a@b.test"]);
    expect(mail.text).toContain("2×24 jam");
  });

  it("sends the code and a share link on approval", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop.test/");
    const mail = buildPartnerApprovedEmail({ to: "a@b.test", name: "Budi", code: "NEX-BUDI", rate: "0.2000", months: 12 }, from);
    expect(mail.text).toContain("NEX-BUDI");
    expect(mail.text).toContain("https://siskop.test/register?ref=NEX-BUDI");
    expect(mail.text).toContain("20%");
  });

  it("gives the rejection reason", () => {
    const mail = buildPartnerRejectedEmail({ to: "a@b.test", name: "Budi", reason: "KTP tidak sesuai" }, from);
    expect(mail.text).toContain("KTP tidak sesuai");
  });
});
