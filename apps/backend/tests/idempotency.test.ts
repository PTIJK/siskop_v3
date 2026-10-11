import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { setupTenant } from "./helpers.js";
import { withIdempotency } from "../src/lib/idempotency.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("withIdempotency", () => {
  it("runs fn and returns its result when no key is given", async () => {
    const admin = await setupTenant();
    const fn = vi.fn(async () => ({ status: 201, envelope: { success: true, data: { id: "x" } } }));

    const result = await withIdempotency(admin.user.tenantId, admin.user.id, null, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 201, envelope: { success: true, data: { id: "x" } } });
  });

  it("runs fn once and stores its result when a key is given", async () => {
    const admin = await setupTenant();
    const fn = vi.fn(async () => ({ status: 201, envelope: { success: true, data: { id: "x" } } }));

    const result = await withIdempotency(admin.user.tenantId, admin.user.id, "key-1", fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 201, envelope: { success: true, data: { id: "x" } } });
    const stored = await db.idempotencyKey.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, key: "key-1" } });
    expect(stored.responseStatus).toBe(201);
  });

  it("replays the stored result without re-running fn on a repeated key", async () => {
    const admin = await setupTenant();
    const fn = vi.fn(async () => ({ status: 201, envelope: { success: true, data: { id: "x" } } }));

    await withIdempotency(admin.user.tenantId, admin.user.id, "key-2", fn);
    const second = await withIdempotency(admin.user.tenantId, admin.user.id, "key-2", fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ status: 201, envelope: { success: true, data: { id: "x" } } });
  });

  it("scopes a key to its own user — a different user with the same key runs fn again", async () => {
    const admin = await setupTenant();
    const fn = vi.fn(async () => ({ status: 201, envelope: { success: true, data: { id: "x" } } }));

    await withIdempotency(admin.user.tenantId, "user-a", "shared-key", fn);
    await withIdempotency(admin.user.tenantId, "user-b", "shared-key", fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not store anything, and lets the error propagate, when fn throws", async () => {
    const admin = await setupTenant();
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(withIdempotency(admin.user.tenantId, admin.user.id, "key-3", fn)).rejects.toThrow("boom");
    const stored = await db.idempotencyKey.findFirst({ where: { tenantId: admin.user.tenantId, key: "key-3" } });
    expect(stored).toBeNull();
  });
});
