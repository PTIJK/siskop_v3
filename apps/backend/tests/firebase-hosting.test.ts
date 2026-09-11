import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { firebaseHosting } from "../src/hosting/firebase.js";

function app() {
  const server = express();
  server.use(firebaseHosting());
  server.use(cookieParser());
  server.get("*", (req, res) => res.json(req.cookies));
  server.post("/complete", (_req, res) => {
    res.cookie("siskop_refresh_token", "staff-token", {
      path: "/api/auth",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 60000
    });
    res.clearCookie("siskop_onboarding", { path: "/api/onboarding" });
    res.end();
  });
  server.post("/member", (_req, res) => {
    res.cookie("siskop_member_refresh_token", "member-token", { path: "/api/member-auth", httpOnly: true });
    res.end();
  });
  server.post("/unrelated", (_req, res) => {
    res.cookie("theme", "dark");
    res.end();
  });
  return server;
}

describe("Firebase Hosting session transport", () => {
  it.each([
    ["/api/onboarding/status", "siskop_onboarding"],
    ["/api/auth/refresh", "siskop_refresh_token"],
    ["/api/member-auth/refresh", "siskop_member_refresh_token"]
  ])("restores the session only for the matching route: %s", async (path, name) => {
    const response = await request(app()).get(path).set("Cookie", "__session=token%2Bvalue");
    expect(response.body).toEqual({ [name]: "token+value" });
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
  it("does not accept legacy cookies, leak sessions into other routes, or match path prefixes", async () => {
    for (const path of ["/api/auth/refresh", "/api/auth-other", "/api/dashboard/summary"]) {
      const response = await request(app()).get(path).set("Cookie", "siskop_refresh_token=injected; theme=dark");
      expect(response.body).toEqual({});
    }
    expect((await request(app()).get("/api/auth-other").set("Cookie", "__session=token")).body).toEqual({});
    expect((await request(app()).get("/api/auth/refresh")).body).toEqual({});
  });
  it("rejects ambiguous duplicate sessions", async () => {
    const response = await request(app()).get("/api/auth/refresh").set("Cookie", "__session=one; __session=two");
    expect(response.body).toEqual({});
  });
  it("keeps completion's new staff session separate from the cleared onboarding session", async () => {
    const response = await request(app()).post("/complete");
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^__session=staff-token;/);
    for (const attribute of ["Path=/api/auth", "HttpOnly", "Secure", "SameSite=Strict"])
      expect(cookies[0]).toContain(attribute);
    expect(cookies[1]).toMatch(/^__session=;/);
    expect(cookies[1]).toContain("Path=/api/onboarding");
    expect(cookies[1]).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("preserves member-session scope and unrelated outbound cookies", async () => {
    expect((await request(app()).post("/member")).headers["set-cookie"][0]).toContain(
      "__session=member-token; Path=/api/member-auth; HttpOnly"
    );
    expect((await request(app()).post("/unrelated")).headers["set-cookie"][0]).toMatch(/^theme=dark;/);
  });
});
