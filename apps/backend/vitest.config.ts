import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one database and truncate it between cases, so
    // files must not run concurrently against it.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      // main.ts and lib/db.ts are bootstrap wiring, not logic: one binds a
      // port, the other constructs the Prisma singleton. Both need a live
      // process/DB to execute, so they are measured by integration tests.
      exclude: ["src/main.ts", "src/hosting/main.ts", "src/lib/db.ts", "src/**/*.d.ts"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 }
    }
  }
});
