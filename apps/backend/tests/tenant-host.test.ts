import { describe, it, expect } from "vitest";
import { slugFromHost } from "../src/modules/auth/tenant-host.js";

describe("slugFromHost", () => {
  it("reads the slug from a localhost subdomain", () => {
    expect(slugFromHost("demo.localhost:3000")).toBe("demo");
  });

  it("ignores the port", () => {
    expect(slugFromHost("demo.localhost")).toBe("demo");
  });

  it("reads the slug from a real domain", () => {
    expect(slugFromHost("demo.siskop.id")).toBe("demo");
  });

  it("lowercases the slug — Host headers are case-insensitive", () => {
    expect(slugFromHost("DEMO.localhost:3000")).toBe("demo");
  });

  it("returns null for bare localhost", () => {
    expect(slugFromHost("localhost:3000")).toBeNull();
  });

  it("returns null for an IPv4 host, whose leading label is not a slug", () => {
    expect(slugFromHost("127.0.0.1:3000")).toBeNull();
  });

  it("returns null for an IPv6 host", () => {
    expect(slugFromHost("[::1]:3000")).toBeNull();
  });

  it("returns null for a missing header", () => {
    expect(slugFromHost(undefined)).toBeNull();
  });

  // `www.siskop.id` and `api.siskop.id` are infrastructure hostnames; treating
  // them as tenant slugs would send a login to a lookup that can only fail.
  it("returns null for reserved infrastructure subdomains", () => {
    expect(slugFromHost("www.siskop.id")).toBeNull();
    expect(slugFromHost("api.siskop.id")).toBeNull();
  });
});
