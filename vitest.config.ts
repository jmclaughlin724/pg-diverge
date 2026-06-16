import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database-gated suites each open several connections (catalog pools of
    // four plus admin clients) against one local PostgreSQL with
    // max_connections=100; unbounded worker parallelism intermittently
    // exhausts it. Four workers keeps the worst case well under the ceiling.
    maxWorkers: 4,
    minWorkers: 1,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "lcov"],
    },
  },
});
