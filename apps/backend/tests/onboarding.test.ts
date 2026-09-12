import { beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { firebaseHosting } from "../src/hosting/firebase.js";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";
import { verifyFirebaseIdentity } from "../src/modules/onboarding/firebase.js";
import { unauthorized } from "../src/lib/errors.js";

vi.mock("../src/modules/onboarding/firebase.js", () => ({ verifyFirebaseIdentity: vi.fn(), assertFirebaseSession: vi.fn() }));

import { applySession } from "../src/modules/onboarding/service.js";

const registration = {
  packageId: "pkg_onboarding_test",
  tenantName: "Koperasi Uji",
  slug: "onboarding-test",
  registrationNo: "ONBOARDING-TEST",
  address: "Jl. Pengujian 1",
  type: "KONVENSIONAL",
  adminName: "Admin Uji",
  adminEmail: "onboarding@example.test",
  password: "TestPassword123",
  idToken: "verified-test-token",
  firstUnit: { type: "KSP", name: "Simpan pinjam" }
};
const sessions = new Map<string, Record<string, unknown>>();
const emailRequests: RequestInit[] = [];
let emailStatus = 200;
let emailWait: Promise<void> | undefined;
let calls = 0;
const fetchProvider = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "https://api.resend.com/emails") {
    emailRequests.push(init!);
    await emailWait;
    return new Response(JSON.stringify(emailStatus === 200 ? { id: "email-test-id" } : { message: "Temporarily unavailable" }), { status: emailStatus });
  }
  if (init?.method === "POST") {
    calls++;
    const body = JSON.parse(String(init.body));
    const session = {
      payment_session_id: `ps-${body.reference_id}`,
      reference_id: body.reference_id,
      session_type: "PAY",
      amount: body.amount,
      currency: "IDR",
      status: "ACTIVE",
      payment_link_url: "https://xen.to/test",
      expires_at: new Date(Date.now() + 1800000).toISOString()
    };
    sessions.set(session.payment_session_id, session);
    return new Response(JSON.stringify(session));
  }
  return new Response(JSON.stringify(sessions.get(url.split("/").pop()!)));
});
async function clean() {
  await db.tenant.deleteMany({ where: { OR: [
    { slug: { startsWith: "onboarding-test" } }, { registrationNo: { startsWith: "ONBOARDING-TEST" } }
  ] } });
}
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://localhost/missing").pathname.endsWith("_test"))
    throw new Error("Use a dedicated database ending in _test for these integration tests");
  await clean();
  vi.mocked(verifyFirebaseIdentity).mockReset().mockResolvedValue({ uid: "onboarding-test-uid", email: registration.adminEmail, provider: "password", authTime: Math.floor(Date.now() / 1000) });
  calls = 0;
  emailRequests.length = 0;
  emailStatus = 200;
  emailWait = undefined;
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
  sessions.clear();
  vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
  vi.stubEnv("XENDIT_SECRET_KEY", "test-only");
  vi.stubEnv("XENDIT_WEBHOOK_TOKEN", "callback-test");
  vi.stubGlobal("fetch", fetchProvider);
  await db.subscriptionPackage.upsert({
    where: { id: registration.packageId },
    update: { isActive: true, price: 500000 },
    create: {
      id: registration.packageId,
      name: "Lengkap",
      price: 500000,
      modules: ["accounting"],
      maxMembers: 500,
      maxUsers: 20
    }
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await clean();
  await db.$disconnect();
});
async function begin() {
  const app = createApp();
  const agent = request.agent(app);
  const registrationResponse = await agent.post("/api/onboarding/register").send(registration);
  expect(registrationResponse.status).toBe(201);
  return { app, agent, order: registrationResponse.body.data };
}
async function callback(
  app: ReturnType<typeof createApp>,
  session: Record<string, unknown>,
  token = "callback-test"
) {
  sessions.set(String(session.payment_session_id), session);
  return request(app)
    .post("/api/onboarding/webhook")
    .set("x-callback-token", token)
    .send({ event: "payment_session.completed", data: session });
}
describe("cooperative onboarding", () => {
  it("generates a valid unique workspace and a default unit when the removed form fields are absent", async () => {
    const app = createApp();
    for (const [index, tenantName] of ["Onboarding Test Sérba Usaha", "Onboarding Test Sérba Usaha", "合作社"].entries()) {
      vi.mocked(verifyFirebaseIdentity).mockResolvedValue({ uid: `onboarding-test-auto-${index}`, email: `auto-${index}@example.test`, provider: "password", authTime: Math.floor(Date.now() / 1000) });
      const response = await request(app).post("/api/onboarding/register").send({
        ...registration, tenantName, slug: undefined, firstUnit: undefined, registrationNo: `ONBOARDING-TEST-${index}`
      });
      expect(response.status).toBe(201);
      expect(response.body.data.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
      expect(response.body.data.slug.length).toBeLessThanOrEqual(63);
      const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: response.body.data.slug }, include: { units: true } });
      expect(tenant.units).toHaveLength(1);
      expect(tenant.units[0]).toMatchObject({ type: "KSP", name: "Simpan pinjam" });
    }
  });
  it("sends one confirmation to the verified administrator only after payment, including duplicate callbacks", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    const { app, agent, order } = await begin();
    expect(emailRequests).toHaveLength(0);
    await agent.post("/api/onboarding/checkout").send({});
    const session = [...sessions.values()][0]!;
    expect(emailRequests).toHaveLength(0);
    expect((await callback(app, { ...session, status: "COMPLETED", amount: 1 })).status).toBe(422);
    expect(emailRequests).toHaveLength(0);
    const paid = { ...session, status: "COMPLETED" };
    expect((await callback(app, paid)).status).toBe(200);
    await Promise.all([callback(app, paid), callback(app, paid)]);
    expect(emailRequests).toHaveLength(1);
    const body = JSON.parse(String(emailRequests[0]!.body));
    expect(body.to).toEqual([registration.adminEmail]);
    expect(body.text).toContain("https://siskop.example/login");
    expect(body.text).toContain(order.id);
    expect(body.text).not.toContain(registration.password);
    const delivery = await db.registrationEmail.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(delivery.status).toBe("SENT");
    expect(delivery.resendId).toBe("email-test-id");
  });
  it("preserves a paid workspace when Resend fails and retries the same message on the next callback", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    const { app, agent, order } = await begin();
    await agent.post("/api/onboarding/checkout").send({});
    const paid = { ...[...sessions.values()][0]!, status: "COMPLETED" };
    emailStatus = 503;
    expect((await callback(app, paid)).status).toBe(500);
    const stored = await db.onboardingOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tenant: true } });
    expect(stored.status).toBe("PAID");
    expect(stored.tenant.isActive).toBe(true);
    expect((await agent.post("/api/onboarding/complete").send({})).status).toBe(200);
    emailStatus = 200;
    expect((await callback(app, paid)).status).toBe(200);
    expect(emailRequests.length).toBeGreaterThanOrEqual(2);
    expect(new Set(emailRequests.map((r) => String(r.body))).size).toBe(1);
    expect(new Set(emailRequests.map((r) => new Headers(r.headers).get("Idempotency-Key"))).size).toBe(1);
    expect((await db.registrationEmail.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe("SENT");
  });
  it("queues confirmation without credentials, then sends after configuration and payment reconciliation", async () => {
    const { agent, order } = await begin();
    await agent.post("/api/onboarding/checkout").send({});
    const session = [...sessions.values()][0]!;
    sessions.set(String(session.payment_session_id), { ...session, status: "COMPLETED" });
    expect((await agent.post("/api/onboarding/reconcile").send({})).body.data.status).toBe("PAID");
    expect(emailRequests).toHaveLength(0);
    expect((await db.registrationEmail.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe("PENDING");
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    expect((await agent.post("/api/onboarding/reconcile").send({})).body.data.status).toBe("PAID");
    expect(emailRequests).toHaveLength(1);
  });
  it("serializes simultaneous first deliveries without holding the payment transaction open", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    const { app, agent, order } = await begin();
    await agent.post("/api/onboarding/checkout").send({});
    const paid = { ...[...sessions.values()][0]!, status: "COMPLETED" };
    let releaseEmail!: () => void;
    emailWait = new Promise<void>((resolve) => { releaseEmail = resolve; });
    const first = callback(app, paid);
    try {
      await vi.waitFor(() => expect(emailRequests).toHaveLength(1));
      expect((await callback(app, paid)).status).toBe(500);
      expect((await agent.get("/api/onboarding/status")).body.data.status).toBe("PAID");
    } finally { releaseEmail(); }
    expect((await first).status).toBe(200);
    expect(emailRequests).toHaveLength(1);
    expect((await db.registrationEmail.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe("SENT");
  });
  it("recovers an interrupted email attempt using its frozen payload and idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    const { app, agent, order } = await begin();
    await agent.post("/api/onboarding/checkout").send({});
    const paid = { ...[...sessions.values()][0]!, status: "COMPLETED" };
    emailStatus = 503;
    await callback(app, paid);
    await db.registrationEmail.update({ where: { orderId: order.id }, data: {
      status: "SENDING", leaseUntil: new Date(Date.now() - 1000), leaseToken: "interrupted-process"
    } });
    vi.stubEnv("RESEND_FROM_EMAIL", "Changed sender <other@siskop.example>");
    vi.stubEnv("PUBLIC_APP_URL", "https://changed.example");
    emailStatus = 200;
    expect((await callback(app, paid)).status).toBe(200);
    expect(emailRequests).toHaveLength(2);
    expect(emailRequests[1]!.body).toBe(emailRequests[0]!.body);
  });
  it("stops automatic retries before Resend's idempotency window expires", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    const { app, agent, order } = await begin();
    await agent.post("/api/onboarding/checkout").send({});
    const paid = { ...[...sessions.values()][0]!, status: "COMPLETED" };
    emailStatus = 503;
    await callback(app, paid);
    await db.registrationEmail.update({ where: { orderId: order.id }, data: { firstAttemptAt: new Date(Date.now() - 24 * 60 * 60_000) } });
    emailStatus = 200;
    expect((await callback(app, paid)).status).toBe(200);
    expect(emailRequests).toHaveLength(1);
    expect((await db.registrationEmail.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe("REVIEW");
    expect((await agent.post("/api/onboarding/complete").send({})).status).toBe(200);
  });
  it("requires a verified Firebase identity for new registrations", async () => {
    const response = await request(createApp()).post("/api/onboarding/register").send({ ...registration, idToken: undefined });
    expect(response.status).toBe(422);
  });
  it("keeps the Firebase session through payment, dashboard refresh, and logout", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = express();
    app.use(firebaseHosting(), createApp());
    const registered = await request(app).post("/api/onboarding/register").send(registration);
    expect(registered.status).toBe(201);
    const cookie = registered.headers["set-cookie"][0].split(";")[0];
    expect(cookie).toMatch(/^__session=/);
    expect((await request(app).get("/api/onboarding/status").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).post("/api/onboarding/checkout").set("Cookie", cookie).send({})).status).toBe(200);
    const session = [...sessions.values()][0]!;
    expect((await callback(app, { ...session, status: "COMPLETED" })).status).toBe(200);
    const completed = await request(app).post("/api/onboarding/complete").set("Cookie", cookie).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.data).toEqual({ next: "login" });
    expect(completed.headers["set-cookie"].every((cookie: string) => cookie.startsWith("__session=;"))).toBe(true);
    const signedIn = await request(app).post("/api/onboarding/login").send({ idToken: registration.idToken });
    expect(signedIn.status).toBe(200);
    const staffCookie = signedIn.headers["set-cookie"].find((value: string) => value.includes("Path=/api/auth"))!.split(";")[0];
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", staffCookie).send({});
    expect(refreshed.status).toBe(200);
    expect((await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${refreshed.body.data.accessToken}`)).status).toBe(200);
    expect((await request(app).get("/api/onboarding/status").set("Cookie", staffCookie)).status).toBe(401);
    const loggedOut = await request(app).post("/api/auth/logout").set("Cookie", staffCookie).send({});
    expect(loggedOut.headers["set-cookie"][0]).toContain("__session=; Path=/api/auth;");
    expect((await request(app).post("/api/auth/refresh").send({})).status).toBe(401);
  });
  it("acknowledges authenticated dashboard samples without activating an order or calling Xendit", async () => {
    const { app, order } = await begin();
    const providerCalls = fetchProvider.mock.calls.length;
    for (const event of ["payment_session.completed", "payment_session.expired"]) {
      const payload = {
        event,
        data: { id: "ps-579c8d61f23fa4ca35e52da4", reference_id: "test_session", session_type: "SAVE" }
      };
      expect((await request(app).post("/api/onboarding/webhook").send(payload)).status).toBe(401);
      expect(
        (await request(app).post("/api/onboarding/webhook").set("x-callback-token", "callback-test").send(payload)).status
      ).toBe(200);
    }
    expect(fetchProvider.mock.calls.length).toBe(providerCalls);
    const stored = await db.onboardingOrder.findUniqueOrThrow({ where: { id: order.id }, include: { tenant: true } });
    expect(stored.status).toBe("PENDING");
    expect(stored.tenant.isActive).toBe(false);
  });
  it("verifies id-format callbacks against Xendit and rejects absent or conflicting IDs", async () => {
    const { app, agent } = await begin();
    await agent.post("/api/onboarding/checkout").send({});
    const session = [...sessions.values()][0]!;
    const deliver = (data: Record<string, unknown>) => request(app)
      .post("/api/onboarding/webhook")
      .set("x-callback-token", "callback-test")
      .send({ event: "payment_session.completed", data });
    expect((await deliver({ reference_id: session.reference_id })).status).toBe(422);
    expect((await deliver({ ...session, id: "ps-conflicting" })).status).toBe(422);
    const data = { id: session.payment_session_id, reference_id: session.reference_id, status: "COMPLETED" };
    // A callback's claimed completion cannot override an ACTIVE provider session.
    expect((await deliver(data)).status).toBe(200);
    expect((await agent.get("/api/onboarding/status")).body.data.status).toBe("PENDING");
    sessions.set(String(session.payment_session_id), { ...session, status: "COMPLETED", amount: 1 });
    expect((await deliver(data)).status).toBe(422);
    sessions.set(String(session.payment_session_id), { ...session, status: "COMPLETED" });
    expect((await deliver(data)).status).toBe(200);
    expect((await agent.get("/api/onboarding/status")).body.data.status).toBe("PAID");
  });
  it("lists only active paid catalog entries and rejects an unavailable package", async () => {
    const app = createApp();
    const catalog = await request(app).get("/api/onboarding/packages");
    expect(catalog.body.data.packages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: registration.packageId, price: "500000" })])
    );
    await db.subscriptionPackage.update({ where: { id: registration.packageId }, data: { isActive: false } });
    expect((await request(app).post("/api/onboarding/register").send(registration)).status).toBe(404);
  });
  it("creates an inactive tenant, never returns auth tokens, and denies unpaid login/completion", async () => {
    const { app, agent, order } = await begin();
    expect(order.accessToken).toBeUndefined();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: registration.slug } });
    expect(tenant.isActive).toBe(false);
    expect((await agent.post("/api/onboarding/complete").send({})).status).toBe(409);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Host", `${registration.slug}.localhost`)
          .send({ email: registration.adminEmail, password: registration.password })
      ).status
    ).toBe(401);
    expect((await request(app).get(`/api/onboarding/status?orderId=${order.id}`)).status).toBe(401);
  });
  it("charges the database price, serializes concurrent checkout, and activates once after confirmed payment", async () => {
    const { app, agent, order } = await begin();
    const results = await Promise.all([
      agent.post("/api/onboarding/checkout").send({ amount: 1 }),
      agent.post("/api/onboarding/checkout").send({ amount: 1 })
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(calls).toBe(1);
    const session = [...sessions.values()][0]!;
    expect(session.amount).toBe(500000);
    expect((await callback(app, { ...session, status: "COMPLETED" }, "wrong-token")).status).toBe(401);
    expect((await callback(app, { ...session, status: "COMPLETED", amount: 1 })).status).toBe(422);
    const paid = { ...session, status: "COMPLETED" };
    expect((await callback(app, paid)).status).toBe(200);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: registration.slug } });
    expect(tenant.isActive).toBe(true);
    expect(tenant.packageId).toBe(registration.packageId);
    await Promise.all([callback(app, paid), callback(app, paid)]);
    await applySession(String(session.reference_id), { ...session, status: "EXPIRED" });
    const after = await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(after.nextBillingDate).toEqual(tenant.nextBillingDate);
    expect((await db.onboardingOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    const complete = await agent.post("/api/onboarding/complete").send({});
    expect(complete.status).toBe(200);
    expect(complete.body.data).toEqual({ next: "login" });
    expect((await agent.post("/api/auth/refresh").send({})).status).toBe(401);
    const signedIn = await agent.post("/api/onboarding/login").send({ idToken: registration.idToken });
    expect(signedIn.body.data.session.user.role).toBe("tenant_admin");
    expect(signedIn.headers["set-cookie"].some((cookie: string) => cookie.includes("HttpOnly"))).toBe(true);
    expect(
      (
        await request(app)
          .get("/api/dashboard/summary")
          .set("Authorization", `Bearer ${signedIn.body.data.session.accessToken}`)
      ).status
    ).toBe(200);
  });
  it("reconciles delayed callbacks and allows a new attempt only after confirmed expiry", async () => {
    const { agent } = await begin();
    await agent.post("/api/onboarding/checkout").send({});
    const session = [...sessions.values()][0]!;
    sessions.set(String(session.payment_session_id), { ...session, status: "EXPIRED" });
    expect((await agent.post("/api/onboarding/reconcile").send({})).body.data.checkout.status).toBe(
      "EXPIRED"
    );
    await agent.post("/api/onboarding/checkout").send({});
    expect(calls).toBe(2);
    const last = [...sessions.values()][1]!;
    sessions.set(String(last.payment_session_id), { ...last, status: "COMPLETED" });
    expect((await agent.post("/api/onboarding/reconcile").send({})).body.data.status).toBe("PAID");
  });
  it("does not duplicate payments after an ambiguous provider timeout", async () => {
    const { agent } = await begin();
    const failed = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", failed);
    expect((await agent.post("/api/onboarding/checkout").send({})).status).toBe(409);
    const retry = await agent.post("/api/onboarding/checkout").send({});
    expect(retry.body.data.checkout.status).toBe("CREATING");
    expect(failed).toHaveBeenCalledTimes(1);
  });
  it("recovers an order using the original admin credentials, rejects duplicates and reserved slugs", async () => {
    const { app, order } = await begin();
    expect((await request(app).post("/api/onboarding/register").send(registration)).status).toBe(409);
    expect(
      (
        await request(app)
          .post("/api/onboarding/register")
          .send({ ...registration, slug: "www" })
      ).status
    ).toBe(422);
    const other = request.agent(app);
    expect(
      (
        await other
          .post("/api/onboarding/resume")
          .send({ slug: registration.slug, email: registration.adminEmail, password: "wrong" })
      ).status
    ).toBe(401);
    expect(
      (
        await other
          .post("/api/onboarding/firebase-resume")
          .send({ idToken: registration.idToken })
      ).body.data.order.id
    ).toBe(order.id);
    expect((await other.get("/api/onboarding/status")).status).toBe(200);
    expect(
      (await other.post("/api/onboarding/checkout").set("Origin", "https://attacker.example").send({})).status
    ).toBe(403);
  });
  it.each(["password", "google.com"] as const)("binds verified %s identity and resumes unpaid orders without a dashboard session", async (provider) => {
    vi.mocked(verifyFirebaseIdentity).mockResolvedValue({ uid: "onboarding-test-uid", email: "trusted@example.test", provider, authTime: Math.floor(Date.now() / 1000) });
    const { app, order } = await begin();
    const user = await db.user.findUniqueOrThrow({ where: { firebaseUid: "onboarding-test-uid" } });
    expect(user.email).toBe("trusted@example.test");
    expect(user.passwordHash).toBeNull();
    expect(user.authProvider).toBe(provider);
    const login = await request(app).post("/api/onboarding/login").send({ idToken: registration.idToken, tenantId: "attacker", email: "attacker@example.test" });
    expect(login.body.data).toMatchObject({ next: "checkout", order: { id: order.id } });
    expect(login.body.data.session).toBeUndefined();
    expect(JSON.stringify(login.body)).not.toContain("refreshToken");
    expect(login.headers["set-cookie"].find((cookie: string) => cookie.includes("Path=/api/auth"))).toContain("siskop_refresh_token=;");
  });
  it("rejects invalid Firebase proof and never links another UID by matching email", async () => {
    const { app } = await begin();
    vi.mocked(verifyFirebaseIdentity).mockResolvedValue({ uid: "another-uid", email: registration.adminEmail, provider: "google.com", authTime: Math.floor(Date.now() / 1000) });
    expect((await request(app).post("/api/onboarding/login").send({ idToken: "other" })).status).toBe(401);
    vi.mocked(verifyFirebaseIdentity).mockRejectedValue(unauthorized());
    expect((await request(app).post("/api/onboarding/login").send({ idToken: "invalid" })).status).toBe(401);
    expect((await request(app).post("/api/onboarding/register").send({ ...registration, slug: "onboarding-test-other", registrationNo: "OTHER" })).status).toBe(401);
    expect(await db.tenant.count({ where: { slug: "onboarding-test-other" } })).toBe(0);
  });
  it("rejects duplicate Firebase bindings and inactive users", async () => {
    const { app } = await begin();
    expect((await request(app).post("/api/onboarding/register").send({ ...registration, slug: "onboarding-test-other", registrationNo: "OTHER" })).status).toBe(409);
    expect(await db.tenant.count({ where: { slug: "onboarding-test-other" } })).toBe(0);
    const bound = await db.user.findUniqueOrThrow({ where: { firebaseUid: "onboarding-test-uid" } });
    await db.user.update({ where: { id: bound.id, tenantId: bound.tenantId }, data: { isActive: false } });
    expect((await request(app).post("/api/onboarding/login").send({ idToken: registration.idToken })).status).toBe(401);
  });
  it("closes the legacy public registration bypass in production even if its dev override is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_LEGACY_REGISTRATION", "true");
    expect((await request(createApp()).post("/api/auth/register").send(registration)).status).toBe(403);
  });
});
