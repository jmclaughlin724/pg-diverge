import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyMigrationSystems, detectMigrationSystems } from "../src/onboard.js";

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
