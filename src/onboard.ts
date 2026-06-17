import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration-system detector (plan `04-adoption-audit-migration-rescue.md` and the
 * X52 onboarding wizard). Detects the incumbent migration tooling in a repo from
 * deterministic marker files — the signatures documented in plan 04. Pure
 * filesystem checks (no parsing, no DB), so adoption/rescue intake can classify the
 * starting state without guessing. Two or more results means a mixed workflow.
 */

interface MigrationSystemSignature {
  /** Relative marker paths; presence of any one identifies the system. */
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

/** Return every migration system whose marker files are present under `rootDir`. */
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
  /** True when more than one migration system is detected. */
  mixed: boolean;
  systems: string[];
}

export function classifyMigrationSystems(rootDir: string): MigrationSystemReport {
  const systems = detectMigrationSystems(rootDir);
  return { mixed: systems.length > 1, systems };
}
