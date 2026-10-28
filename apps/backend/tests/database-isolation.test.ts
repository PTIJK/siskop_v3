import { describe, expect, it } from "vitest";
import { poolDatabase, testDatabaseUrl, testWorkerCount } from "./database-isolation.js";

describe("parallel test database boundaries", () => {
  it("caps concurrency and rejects malformed worker counts", () => {
    expect(testWorkerCount("1")).toBe(1);
    expect(testWorkerCount("3")).toBe(3);
    for (const value of ["0", "5", "3abc", "", "true"]) expect(() => testWorkerCount(value)).toThrow();
  });
  it("rejects remote, unnamed and non-test database targets", () => {
    for (const value of ["postgresql://db.example.invalid/app_test", "postgresql://localhost/production", "postgresql://localhost/test", "mysql://localhost/app_test"])
      expect(() => testDatabaseUrl(value)).toThrow();
    expect(testDatabaseUrl("postgresql://postgres@siskop-ci-postgres/siskop_ci_test").hostname).toBe("siskop-ci-postgres");
  });
  it("assigns different exclusive pool slots to different disposable databases", () => {
    const urls = [1, 2, 3].map(i => `postgresql://postgres@127.0.0.1/siskop_vitest_0123456789abcdef_w${i}_test`);
    expect(new Set([1, 2, 3].map(i => poolDatabase(urls, String(i), 3))).size).toBe(3);
    for (const id of [undefined, "0", "4", "100", "1x"]) expect(() => poolDatabase(urls, id, 3)).toThrow();
    expect(() => poolDatabase(undefined, "1", 3)).toThrow();
    expect(() => poolDatabase(["postgresql://localhost/siskop_test"], "1", 1)).toThrow();
  });
});
