import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";

const VALID_BODY = {
  fullName: "Budi Santoso",
  nik: "3171234567890001",
  address: "Jl. Kebon Jeruk No. 5, Jakarta Barat",
  birthPlace: "Jakarta",
  birthDate: "1985-03-15",
  occupation: "Pedagang",
  captchaToken: "any-token-is-fine-when-fetch-is-stubbed"
};

// mockImplementation (not mockResolvedValue), so each of the 6 rate-limit-test
// calls gets a fresh Response — a Response body stream can only be read once,
// and a shared instance would make every call after the first look like a
// captcha failure once verifyCaptcha's res.json() throws on the reused stream.
function stubCaptchaSuccess() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
  );
}
function stubCaptchaFailure() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
  );
}

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/public/register/:tenantSlug", () => {
  it("returns tenant branding and the enabled flag", async () => {
    await setupTenant({ slug: "demo" });

    const res = await request(app()).get("/api/public/register/demo");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tenantName: "KSP Demo", selfRegistrationEnabled: true });
  });

  it("still returns branding (with enabled:false) for a tenant that disabled self-registration — the closed-state page needs the tenant name", async () => {
    const tenant = await setupTenant({ slug: "demo" });
    await db.tenant.update({ where: { id: tenant.user.tenantId }, data: { selfRegistrationEnabled: false } });

    const res = await request(app()).get("/api/public/register/demo");

    expect(res.status).toBe(200);
    expect(res.body.data.selfRegistrationEnabled).toBe(false);
  });

  it("404s for an unknown slug, revealing nothing else", async () => {
    const res = await request(app()).get("/api/public/register/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/public/register/:tenantSlug", () => {
  it("creates a PENDING request, masks the NIK, and returns no internal IDs", async () => {
    stubCaptchaSuccess();
    const tenant = await setupTenant({ slug: "demo" });

    const res = await request(app()).post("/api/public/register/demo").send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.nikMasked).toBe("************0001");
    expect(res.body.data.message).toContain("diproses");
    expect(res.body.data).not.toHaveProperty("id");
    expect(res.body.data).not.toHaveProperty("tenantId");
    expect(JSON.stringify(res.body.data)).not.toContain("3171234567890001");

    const created = await db.memberRegistrationRequest.findFirstOrThrow({
      where: { tenantId: tenant.user.tenantId, nik: VALID_BODY.nik }
    });
    expect(created.status).toBe("PENDING");
    expect(created.fullName).toBe(VALID_BODY.fullName);
  });

  it("raises a tenant notification visible to members.create holders, with the pending count in the message", async () => {
    stubCaptchaSuccess();
    const tenant = await setupTenant({ slug: "demo" });

    await request(app()).post("/api/public/register/demo").send(VALID_BODY);

    const notification = await db.tenantNotification.findFirstOrThrow({
      where: { tenantId: tenant.user.tenantId, type: "MEMBER_REGISTRATION_PENDING" }
    });
    expect(notification.permissionModule).toBe("members");
    expect(notification.permissionAction).toBe("create");
    expect(notification.message).toBe("1 pendaftaran mandiri menunggu persetujuan");
  });

  it("404s when the tenant does not exist", async () => {
    stubCaptchaSuccess();
    const res = await request(app()).post("/api/public/register/does-not-exist").send(VALID_BODY);
    expect(res.status).toBe(404);
  });

  it("responds identically (404) whether the tenant is disabled or nonexistent, and writes nothing", async () => {
    stubCaptchaSuccess();
    const tenant = await setupTenant({ slug: "demo" });
    await db.tenant.update({ where: { id: tenant.user.tenantId }, data: { selfRegistrationEnabled: false } });

    const res = await request(app()).post("/api/public/register/demo").send(VALID_BODY);

    expect(res.status).toBe(404);
    const count = await db.memberRegistrationRequest.count({ where: { tenantId: tenant.user.tenantId } });
    expect(count).toBe(0);
  });

  it("fails closed with 400 CAPTCHA_FAILED on an invalid token and writes nothing to the database", async () => {
    stubCaptchaFailure();
    const tenant = await setupTenant({ slug: "demo" });

    const res = await request(app()).post("/api/public/register/demo").send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CAPTCHA_FAILED");
    const count = await db.memberRegistrationRequest.count({ where: { tenantId: tenant.user.tenantId } });
    expect(count).toBe(0);
  });

  it("fails closed with 400 on a missing captcha token and writes nothing", async () => {
    stubCaptchaSuccess();
    const tenant = await setupTenant({ slug: "demo" });
    const { captchaToken: _drop, ...bodyWithoutToken } = VALID_BODY;

    const res = await request(app()).post("/api/public/register/demo").send(bodyWithoutToken);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CAPTCHA_FAILED");
    const count = await db.memberRegistrationRequest.count({ where: { tenantId: tenant.user.tenantId } });
    expect(count).toBe(0);
  });

  it("rejects the 6th submission from the same IP within the default 5/hour window", async () => {
    stubCaptchaSuccess();
    await setupTenant({ slug: "demo" });
    const testApp = app();

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(testApp)
        .post("/api/public/register/demo")
        .send({ ...VALID_BODY, nik: `317123456789000${i}` });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });

  it("rejects invalid field data with 422, same rules as the internal CreateMemberSchema", async () => {
    stubCaptchaSuccess();
    await setupTenant({ slug: "demo" });

    const res = await request(app())
      .post("/api/public/register/demo")
      .send({ ...VALID_BODY, nik: "123" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("warns (but does not block) when the NIK already belongs to a Member in this tenant", async () => {
    stubCaptchaSuccess();
    const admin = await setupTenant({ slug: "demo" });
    await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        fullName: "Existing Member",
        nik: VALID_BODY.nik,
        address: "Jl. Lain No. 1, Jakarta",
        birthPlace: "Jakarta",
        birthDate: "1980-01-01",
        occupation: "Pegawai"
      });

    const res = await request(app()).post("/api/public/register/demo").send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.nikWarning).toBe(true);
  });

  it("does not warn for a NIK nobody has used yet", async () => {
    stubCaptchaSuccess();
    await setupTenant({ slug: "demo" });

    const res = await request(app()).post("/api/public/register/demo").send(VALID_BODY);

    expect(res.body.data.nikWarning).toBe(false);
  });

  it("ignores a spoofed tenantId in the body — the row is created under the URL's tenant only, never the other tenant", async () => {
    stubCaptchaSuccess();
    const tenantA = await setupTenant({ slug: "demo" });
    const tenantB = await setupTenant({ slug: "demo2", registrationNo: "KOP-DEMO2" });

    const res = await request(app())
      .post("/api/public/register/demo")
      .send({ ...VALID_BODY, tenantId: tenantB.user.tenantId });

    expect(res.status).toBe(201);
    const inTenantA = await db.memberRegistrationRequest.count({ where: { tenantId: tenantA.user.tenantId } });
    const inTenantB = await db.memberRegistrationRequest.count({ where: { tenantId: tenantB.user.tenantId } });
    expect(inTenantA).toBe(1);
    expect(inTenantB).toBe(0);
  });

  it("rejects a KTP file whose bytes don't match its declared image/jpeg content-type", async () => {
    stubCaptchaSuccess();
    const tenant = await setupTenant({ slug: "demo" });

    const res = await request(app())
      .post("/api/public/register/demo")
      .field("fullName", VALID_BODY.fullName)
      .field("nik", VALID_BODY.nik)
      .field("address", VALID_BODY.address)
      .field("birthPlace", VALID_BODY.birthPlace)
      .field("birthDate", VALID_BODY.birthDate)
      .field("occupation", VALID_BODY.occupation)
      .field("captchaToken", VALID_BODY.captchaToken)
      .attach("ktp", Buffer.from("<script>not really a jpeg</script>"), { filename: "ktp.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_FILE_TYPE");
    const count = await db.memberRegistrationRequest.count({ where: { tenantId: tenant.user.tenantId } });
    expect(count).toBe(0);
  });

  it("accepts a genuine JPEG KTP photo and stores its URL", async () => {
    stubCaptchaSuccess();
    const tenant = await setupTenant({ slug: "demo" });
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

    const res = await request(app())
      .post("/api/public/register/demo")
      .field("fullName", VALID_BODY.fullName)
      .field("nik", VALID_BODY.nik)
      .field("address", VALID_BODY.address)
      .field("birthPlace", VALID_BODY.birthPlace)
      .field("birthDate", VALID_BODY.birthDate)
      .field("occupation", VALID_BODY.occupation)
      .field("captchaToken", VALID_BODY.captchaToken)
      .attach("ktp", jpegBytes, { filename: "ktp.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    const created = await db.memberRegistrationRequest.findFirstOrThrow({
      where: { tenantId: tenant.user.tenantId, nik: VALID_BODY.nik }
    });
    expect(created.ktpPhotoUrl).toMatch(/^\/uploads\/ktp\/.+\.jpg$/);
  });
});
