import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { verifyIdToken, getUser, initializeApp } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(), getUser: vi.fn(), initializeApp: vi.fn()
}));
vi.mock("firebase-admin/app", () => ({ getApps: () => [], initializeApp }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken, getUser }) }));
import { verifyFirebaseIdentity, assertFirebaseSession } from "../src/modules/onboarding/firebase.js";
const now = Math.floor(Date.now() / 1000);
const token = { uid: "verified-uid", email: "Admin@example.test", auth_time: now, firebase: { sign_in_provider: "password" } };
beforeEach(() => {
  vi.stubEnv("FIREBASE_PROJECT_ID", "demo-siskop");
  vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
  verifyIdToken.mockReset().mockResolvedValue(token);
  getUser.mockReset().mockResolvedValue({ disabled: false, tokensValidAfterTime: new Date((now - 60) * 1000).toISOString() });
});
afterEach(() => vi.unstubAllEnvs());
describe("Firebase trust boundary", () => {
  it.each(["password", "google.com"])("verifies %s tokens with revocation checks and the configured project", async (provider) => {
    verifyIdToken.mockResolvedValue({ ...token, firebase: { sign_in_provider: provider } });
    expect(await verifyFirebaseIdentity("proof")).toEqual({ uid: token.uid, email: "admin@example.test", provider, authTime: now });
    expect(verifyIdToken).toHaveBeenCalledWith("proof", true);
    expect(initializeApp).toHaveBeenCalledWith({ projectId: "demo-siskop" }, "siskop-auth");
  });
  it.each([
    { ...token, auth_time: now - 601 },
    { ...token, auth_time: now + 120 },
    { ...token, email: undefined },
    { ...token, firebase: { sign_in_provider: "anonymous" } }
  ])("rejects stale, malformed or unsupported identity", async (invalid) => {
    verifyIdToken.mockResolvedValue(invalid);
    await expect(verifyFirebaseIdentity("proof")).rejects.toThrow("UNAUTHORIZED");
  });
  it("rejects invalid signatures and revoked tokens without leaking SDK errors", async () => {
    verifyIdToken.mockRejectedValue(new Error("private SDK diagnostic"));
    await expect(verifyFirebaseIdentity("forged")).rejects.toThrow("UNAUTHORIZED");
    await expect(verifyFirebaseIdentity("forged")).rejects.not.toThrow("private SDK");
  });
  it("fails closed without a project or when production points at an emulator", async () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    await expect(verifyFirebaseIdentity("proof")).rejects.toThrow("UNAUTHORIZED");
    vi.stubEnv("FIREBASE_PROJECT_ID", "demo-siskop");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099");
    await expect(verifyFirebaseIdentity("proof")).rejects.toThrow("UNAUTHORIZED");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
  it("refreshes only active accounts with an unrevoked original authentication time", async () => {
    await expect(assertFirebaseSession("verified-uid", now)).resolves.toBeUndefined();
    await expect(assertFirebaseSession("verified-uid", undefined)).rejects.toThrow("UNAUTHORIZED");
    getUser.mockResolvedValue({ disabled: true });
    await expect(assertFirebaseSession("verified-uid", now)).rejects.toThrow("UNAUTHORIZED");
    getUser.mockResolvedValue({ disabled: false, tokensValidAfterTime: new Date((now + 10) * 1000).toISOString() });
    await expect(assertFirebaseSession("verified-uid", now)).rejects.toThrow("UNAUTHORIZED");
    getUser.mockRejectedValue(new Error("deleted account"));
    await expect(assertFirebaseSession("verified-uid", now)).rejects.toThrow("UNAUTHORIZED");
  });
});
