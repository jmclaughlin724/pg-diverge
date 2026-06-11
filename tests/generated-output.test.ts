import { describe, expect, it } from "vitest";
import { checkMigrationSql } from "../src/check.js";
import type { PgDivergeConfig } from "../src/core.js";
import { resolveDatabaseUrl } from "../src/database-url.js";
import { planSchemaDiff } from "../src/planner.js";
import { renderMigration } from "../src/render.js";
import { extractSourceModel } from "../src/source.js";
import { parseSqlAst } from "../src/sql/parser.js";
import { verifyMigration } from "../src/verify.js";

const databaseUrl = process.env.PG_DIVERGE_TEST_DATABASE_URL ?? resolveDatabaseUrl();

interface Scenario {
  config?: Partial<PgDivergeConfig>;
  ensureRoles?: boolean;
  from: string;
  name: string;
  to: string;
}

const scenarios: Scenario[] = [
  { from: "dir:tests/fixtures/basic/from", name: "basic", to: "dir:tests/fixtures/basic/to" },
  {
    from: "dir:tests/fixtures/add-column/from",
    name: "add-column",
    to: "dir:tests/fixtures/add-column/to",
  },
  {
    from: "dir:tests/fixtures/dependent-views/from",
    name: "dependent-views",
    to: "dir:tests/fixtures/dependent-views/to",
  },
  {
    config: { adapter: "postgres" },
    ensureRoles: true,
    from: "dir:tests/fixtures/dependent-views/from",
    name: "parity-tree",
    to: "dir:tests/fixtures/parity/tree",
  },
  {
    config: { adapter: "postgres" },
    from: "dir:tests/fixtures/dependent-views/from",
    name: "hostile",
    to: "dir:tests/fixtures/parity/hostile",
  },
];

async function renderScenario(scenario: Scenario): Promise<string> {
  const options = scenario.config ? { config: scenario.config } : {};
  const from = await extractSourceModel(scenario.from, options);
  const to = await extractSourceModel(scenario.to, options);
  expect(
    [...from.diagnostics, ...to.diagnostics].filter((item) => item.severity === "error"),
  ).toEqual([]);
  const plan = planSchemaDiff(from, to, options);
  expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return renderMigration(plan, options);
}

describe.each(scenarios)("generated migration standards: $name", (scenario) => {
  it("parses cleanly through the PostgreSQL parser", async () => {
    const sql = await renderScenario(scenario);
    const parsed = await parseSqlAst(sql);

    expect(parsed.ast).toBeDefined();
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("passes pg-diverge's own replay-safety checker", async () => {
    const sql = await renderScenario(scenario);
    const diagnostics = await checkMigrationSql(
      sql,
      scenario.config ? { config: scenario.config } : {},
    );

    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("carries the lock and statement timeout preamble", async () => {
    const sql = await renderScenario(scenario);

    expect(sql).toContain("SET lock_timeout = ");
    expect(sql).toContain("SET statement_timeout = ");
  });

  it("never emits CASCADE and never references catalogs unqualified", async () => {
    const sql = await renderScenario(scenario);

    expect(sql).not.toMatch(/\bCASCADE\b/i);
    expect(sql).not.toMatch(/(?<!pg_catalog\.)\bpg_(?:type|class|namespace|constraint|roles)\b/);
    expect(sql).not.toMatch(/(?<!pg_catalog\.)\bto_reg(?:class|procedure)\(/);
  });

  it.skipIf(!databaseUrl)(
    "applies twice against a disposable database and matches the target catalog",
    { timeout: 60_000 },
    async () => {
      if (!databaseUrl) {
        return;
      }
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const sql = await renderScenario(scenario);
      const directory = await mkdtemp(join(tmpdir(), `pgd-out-${scenario.name}-`));
      const migrationPath = join(directory, "migration.sql");
      await writeFile(migrationPath, sql);

      const diagnostics = await verifyMigration({
        ...(scenario.config ? { config: scenario.config } : {}),
        databaseUrl,
        ensureRoles: scenario.ensureRoles === true,
        from: scenario.from,
        migrationPath,
        to: scenario.to,
      });

      expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    },
  );
});
