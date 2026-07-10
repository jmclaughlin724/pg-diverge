import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReadinessReport,
  classifyMigrationSystems,
  detectMigrationSystems,
  renderReadiness,
} from "../../src/onboard.js";
import type { ScanResult } from "../../src/scan/model.js";

function scanResult(score: number, findings: number): ScanResult {
  return {
    diagnostics: Array.from({ length: findings }, () => ({
      code: "X",
      message: "m",
      severity: "warning",
    })),
    errorCount: 0,
    score,
    warningCount: findings,
  };
}

function makeRepo(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "supaschema-onboard-"));
  for (const file of files) {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "x");
  }
  return root;
}

describe("migration-system detector (X52 / plan 04)", () => {
  it("detects Prisma from prisma/schema.prisma", () => {
    expect(detectMigrationSystems(makeRepo(["prisma/schema.prisma"]))).toEqual(["Prisma"]);
  });

  it("detects Supabase CLI from supabase/config.toml", () => {
    expect(detectMigrationSystems(makeRepo(["supabase/config.toml"]))).toEqual(["Supabase CLI"]);
  });

  it("flags a mixed workflow when two systems are present", () => {
    const report = classifyMigrationSystems(makeRepo(["supabase/config.toml", "flyway.conf"]));
    expect(report.mixed).toBe(true);
    expect(report.systems).toContain("Supabase CLI");
    expect(report.systems).toContain("Flyway");
  });

  it("returns nothing for a repo with no migration tooling", () => {
    const report = classifyMigrationSystems(makeRepo(["README.md"]));
    expect(report.systems).toHaveLength(0);
    expect(report.mixed).toBe(false);
  });
});

describe("onboarding readiness report (X52)", () => {
  it("is READY on a clean single-system repo", () => {
    const report = buildReadinessReport(
      { mixed: false, systems: ["supaschema"] },
      scanResult(100, 0),
      "A"
    );
    expect(report.ready).toBe(true);
    expect(renderReadiness(report)).toContain("READY");
  });

  it("is not ready on a mixed workflow even with a high score", () => {
    const report = buildReadinessReport(
      { mixed: true, systems: ["Prisma", "Flyway"] },
      scanResult(100, 0),
      "A"
    );
    expect(report.ready).toBe(false);
    expect(renderReadiness(report)).toContain("needs work");
  });

  it("is not ready below the readiness score threshold", () => {
    const report = buildReadinessReport(
      { mixed: false, systems: ["supaschema"] },
      scanResult(70, 5),
      "C"
    );
    expect(report.ready).toBe(false);
    expect(report.findingCount).toBe(5);
  });
});
