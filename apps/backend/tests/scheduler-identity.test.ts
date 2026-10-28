import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("google-auth-library", () => ({ OAuth2Client: class { verifyIdToken = mocks.verify; } }));
import { verifySchedulerIdentity } from "../src/hosting/scheduler-identity.js";

const email = "siskop-scheduler-invoker@siskop-d0f8c.iam.gserviceaccount.com";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("external scheduler identity", () => {
  it("retains Cloud Run's existing identity boundary", async () => {
    await verifySchedulerIdentity(undefined);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("requires a token and audience on Contabo", async () => {
    vi.stubEnv("SISKOP_HOSTING", "contabo");
    await expect(verifySchedulerIdentity(undefined)).rejects.toThrow("Invalid scheduler identity");
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("validates the token for the configured audience and exact service account", async () => {
    vi.stubEnv("SISKOP_HOSTING", "contabo");
    vi.stubEnv("SCHEDULER_OIDC_AUDIENCE", "https://siskop-api.inovasijayakarsa.id");
    mocks.verify.mockResolvedValue({ getPayload: () => ({ email, email_verified: true, iss: "https://accounts.google.com", sub: "service-account-id" }) });
    await verifySchedulerIdentity("Bearer signed-google-token");
    expect(mocks.verify).toHaveBeenCalledWith({ idToken: "signed-google-token", audience: "https://siskop-api.inovasijayakarsa.id" });
  });
  it.each([
    { email: "other@example.com", email_verified: true, iss: "https://accounts.google.com", sub: "id" },
    { email, email_verified: false, iss: "https://accounts.google.com", sub: "id" },
    { email, email_verified: true, iss: "https://attacker.example", sub: "id" }
  ])("rejects an unauthorized payload", async payload => {
    vi.stubEnv("SISKOP_HOSTING", "contabo");
    vi.stubEnv("SCHEDULER_OIDC_AUDIENCE", "https://siskop-api.inovasijayakarsa.id");
    mocks.verify.mockResolvedValue({ getPayload: () => payload });
    await expect(verifySchedulerIdentity("Bearer token")).rejects.toThrow("Invalid scheduler identity");
  });
  it("fails closed on signature/expiry/audience verification errors", async () => {
    vi.stubEnv("SISKOP_HOSTING", "contabo");
    vi.stubEnv("SCHEDULER_OIDC_AUDIENCE", "https://siskop-api.inovasijayakarsa.id");
    mocks.verify.mockRejectedValue(new Error("expired or invalid signature"));
    await expect(verifySchedulerIdentity("Bearer token")).rejects.toThrow("Invalid scheduler identity");
  });
  it("allows the builder to inspect readiness but never to run scheduled writes", async () => {
    vi.stubEnv("SISKOP_HOSTING", "contabo");
    vi.stubEnv("SCHEDULER_OIDC_AUDIENCE", "https://siskop-api.inovasijayakarsa.id:18443");
    mocks.verify.mockResolvedValue({ getPayload: () => ({ email: "siskop-cloud-build@siskop-d0f8c.iam.gserviceaccount.com", email_verified: true, iss: "https://accounts.google.com", sub: "builder-id" }) });
    await verifySchedulerIdentity("Bearer token", true);
    await expect(verifySchedulerIdentity("Bearer token")).rejects.toThrow("Invalid scheduler identity");
  });
});
