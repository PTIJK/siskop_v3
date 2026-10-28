import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSetupContext } from "vitest/node";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), disconnect: vi.fn(), urls: [] as string[]
}));
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    url: string;
    constructor({ datasourceUrl }: { datasourceUrl: string }) { this.url = datasourceUrl; mocks.urls.push(datasourceUrl); }
    $executeRawUnsafe(sql: string) { return mocks.execute(sql, this.url); }
    $queryRaw(...args: unknown[]) { return mocks.query(...args); }
    $disconnect() { return mocks.disconnect(this.url); }
  }
}));
import setup from "./database-global.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.urls.length = 0;
  mocks.execute.mockResolvedValue(0);
  mocks.query.mockResolvedValue([{ tablename: "Tenant" }]);
  mocks.disconnect.mockResolvedValue(undefined);
  vi.stubEnv("SISKOP_TEST_WORKERS", "3");
  vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1/base_test");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("isolated database lifecycle", () => {
  it("clones per slot, clears only owned clones and drops exactly those names", async () => {
    const provide = vi.fn();
    const close = await setup({ provide } as unknown as GlobalSetupContext);
    const urls = provide.mock.calls[0]?.[1] as string[];
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(3);
    const creates = mocks.execute.mock.calls.filter(([sql]) => sql.startsWith("CREATE DATABASE"));
    expect(creates).toHaveLength(3);
    for (const [sql, url] of mocks.execute.mock.calls) {
      if (sql.startsWith("TRUNCATE")) expect(new URL(url).pathname).toMatch(/^\/siskop_vitest_[a-f0-9]{16}_w[1-3]_test$/);
    }
    await close();
    const drops = mocks.execute.mock.calls.filter(([sql]) => sql.startsWith("DROP DATABASE"));
    expect(drops.map(([sql]) => sql.match(/"([^"]+)"/)[1]).sort())
      .toEqual(creates.map(([sql]) => sql.match(/"([^"]+)"/)[1]).sort());
    expect(drops.every(([sql]) => !sql.includes('"base_test"'))).toBe(true);
  });

  it("cleans earlier owned clones if a later clone fails", async () => {
    let count = 0;
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.startsWith("CREATE DATABASE") && ++count === 2) throw new Error("clone failed");
      return 0;
    });
    await expect(setup({ provide: vi.fn() } as unknown as GlobalSetupContext)).rejects.toThrow("clone failed");
    expect(mocks.execute.mock.calls.filter(([sql]) => sql.startsWith("DROP DATABASE"))).toHaveLength(1);
    expect(mocks.disconnect).toHaveBeenCalled();
  });

  it("rejects a remote template before creating any client or database", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://remote.example.invalid/base_test");
    await expect(setup({ provide: vi.fn() } as unknown as GlobalSetupContext)).rejects.toThrow("local");
    expect(mocks.urls).toHaveLength(0);
  });

  it("reports cleanup failures instead of silently leaving databases", async () => {
    const close = await setup({ provide: vi.fn() } as unknown as GlobalSetupContext);
    mocks.execute.mockRejectedValue(new Error("drop denied"));
    await expect(close()).rejects.toThrow("clean up");
    expect(mocks.execute.mock.calls.filter(([sql]) => sql.startsWith("DROP DATABASE"))).toHaveLength(3);
  });
});
