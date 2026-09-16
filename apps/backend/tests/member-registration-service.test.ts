import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { getSelfRegistrationLink, listRegistrationRequests } from "../src/modules/members/registration.service.js";
import { setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSelfRegistrationLink", () => {
  it("builds a stable path-based URL off PUBLIC_APP_URL and the tenant's slug, not its subdomain", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
    const tenant = await setupTenant();

    const result = await getSelfRegistrationLink(tenant.user.tenantId);

    expect(result.url).toBe("https://siskop.example/daftar/demo");
  });
});

describe("listRegistrationRequests", () => {
  async function seedRequest(tenantId: string, overrides: Partial<Parameters<typeof db.memberRegistrationRequest.create>[0]["data"]> = {}) {
    return db.memberRegistrationRequest.create({
      data: {
        tenantId,
        fullName: "Budi Santoso",
        nik: "3171234567890001",
        address: "Jl. Kebon Jeruk No. 5, Jakarta Barat",
        birthPlace: "Jakarta",
        birthDate: new Date("1985-03-15"),
        occupation: "Pedagang",
        ...overrides
      }
    });
  }

  it("only returns requests belonging to the given tenant", async () => {
    const tenantA = await setupTenant({ slug: "demo" });
    const tenantB = await setupTenant({ slug: "demo2", registrationNo: "KOP-DEMO2" });
    await seedRequest(tenantA.user.tenantId, { nik: "3171234567890001" });
    await seedRequest(tenantB.user.tenantId, { nik: "3171234567890002" });

    const result = await listRegistrationRequests(tenantA.user.tenantId, { page: 1, limit: 20, status: "PENDING" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.nik).toBe("3171234567890001");
    expect(result.meta.total).toBe(1);
  });

  it("filters by status", async () => {
    const tenant = await setupTenant();
    await seedRequest(tenant.user.tenantId, { nik: "3171234567890001", status: "PENDING" });
    await seedRequest(tenant.user.tenantId, { nik: "3171234567890002", status: "APPROVED" });

    const pending = await listRegistrationRequests(tenant.user.tenantId, { page: 1, limit: 20, status: "PENDING" });
    const approved = await listRegistrationRequests(tenant.user.tenantId, { page: 1, limit: 20, status: "APPROVED" });

    expect(pending.items).toHaveLength(1);
    expect(pending.items[0]?.status).toBe("PENDING");
    expect(approved.items).toHaveLength(1);
    expect(approved.items[0]?.status).toBe("APPROVED");
  });

  it("paginates newest-first", async () => {
    const tenant = await setupTenant();
    // Fast inserts can share a millisecond; make the intended age difference explicit.
    await seedRequest(tenant.user.tenantId, { nik: "3171234567890001", fullName: "First", submittedAt: new Date("2026-01-01T00:00:00Z") });
    await seedRequest(tenant.user.tenantId, { nik: "3171234567890002", fullName: "Second", submittedAt: new Date("2026-01-02T00:00:00Z") });

    const result = await listRegistrationRequests(tenant.user.tenantId, { page: 1, limit: 1, status: "PENDING" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.fullName).toBe("Second");
    expect(result.meta.total).toBe(2);
  });
});
