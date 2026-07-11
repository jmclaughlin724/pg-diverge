import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["src/**/AGENTS.md"],
      include: ["src/**"],
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        branches: 55,
        functions: 64,
        lines: 60,
        statements: 60,
      },
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    maxWorkers: 4,
    minWorkers: 1,
    pool: "forks",
  },
});
