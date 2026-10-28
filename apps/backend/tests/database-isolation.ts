export function testWorkerCount(value = process.env.SISKOP_TEST_WORKERS): number {
  if (value === undefined) return 1;
  if (!/^[1-4]$/.test(value)) throw new Error("SISKOP_TEST_WORKERS must be an integer from 1 to 4");
  return Number(value);
}

export function testDatabaseUrl(value: string): URL {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]", "siskop-ci-postgres"].includes(url.hostname) ||
      !/^\/[a-z][a-z0-9_]*_test$/.test(url.pathname)) {
    throw new Error("Parallel tests require a local, explicitly named _test database");
  }
  return url;
}

export function poolDatabase(urls: string[] | undefined, id: string | undefined, count: number): string {
  if (!Array.isArray(urls) || urls.length !== count || !id || !/^[1-4]$/.test(id) || Number(id) > count) {
    throw new Error("Missing or invalid isolated test database assignment");
  }
  const selected = urls[Number(id) - 1];
  if (typeof selected !== "string") throw new Error("Missing isolated database URL");
  const url = testDatabaseUrl(selected);
  if (!/^\/siskop_vitest_[a-f0-9]{16}_w[1-4]_test$/.test(url.pathname)) {
    throw new Error("Worker database must belong to this disposable test run");
  }
  return url.toString();
}
