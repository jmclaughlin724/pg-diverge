import { existsSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "./redaction.js";
import type { ScanResult } from "./scan/model.js";

interface MigrationSystemSignature {
  markers: string[];
  name: string;
}

const SIGNATURES: MigrationSystemSignature[] = [
  { markers: ["supabase/config.toml"], name: "Supabase CLI" },
  { markers: ["prisma/schema.prisma"], name: "Prisma" },
  { markers: ["flyway.conf", "flyway.toml"], name: "Flyway" },
  { markers: ["liquibase.properties"], name: "Liquibase" },
  { markers: ["atlas.hcl"], name: "Atlas" },
  { markers: ["drizzle.config.ts", "drizzle.config.js"], name: "Drizzle" },
  { markers: ["db/schema.rb", "db/structure.sql"], name: "Rails" },
  { markers: ["supaschema.config.json"], name: "supaschema" },
];

export function detectMigrationSystems(rootDir: string): string[] {
  const detected: string[] = [];
  for (const signature of SIGNATURES) {
    if (signature.markers.some((marker) => existsSync(join(rootDir, marker)))) {
      detected.push(signature.name);
    }
  }
  return detected;
}

export interface MigrationSystemReport {
  mixed: boolean;
  systems: string[];
}

export function classifyMigrationSystems(rootDir: string): MigrationSystemReport {
  const systems = detectMigrationSystems(rootDir);
  return { mixed: systems.length > 1, systems };
}

const READY_SCORE = 90;

export interface ReadinessReport {
  findingCount: number;
  grade: string;
  migrationSystems: string[];
  mixed: boolean;
  ready: boolean;
  score: number;
}

export function buildReadinessReport(
  systems: MigrationSystemReport,
  scan: ScanResult,
  grade: string
): ReadinessReport {
  return {
    findingCount: scan.diagnostics.length,
    grade,
    migrationSystems: systems.systems,
    mixed: systems.mixed,
    ready: scan.score >= READY_SCORE && !systems.mixed,
    score: scan.score,
  };
}

export function renderReadiness(report: ReadinessReport): string {
  const systems =
    report.migrationSystems.length > 0 ? report.migrationSystems.join(", ") : "none detected";
  const lines = [
    `Migration system: ${systems}${report.mixed ? " (mixed workflow)" : ""}`,
    `Postgres safety: ${report.score}/100 (${report.grade}) — ${report.findingCount} finding(s)`,
    `Onboarding readiness: ${report.ready ? "READY" : "needs work"}`,
  ];
  return redactSecrets(lines.join("\n"));
}
