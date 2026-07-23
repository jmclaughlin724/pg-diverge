import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PgState {
  clientConstructions: number;
  poolConstructions: number;
  poolEndCalls: number;
  poolOptions: unknown[];
  queryError: Error | undefined;
  queryTexts: string[];
}

const pgState = vi.hoisted(
  (): PgState => ({
    clientConstructions: 0,
    poolConstructions: 0,
    poolEndCalls: 0,
    poolOptions: [],
    queryError: undefined,
    queryTexts: [],
  })
);

vi.mock("pg", () => {
  class FakePool {
    constructor(options: unknown) {
      pgState.poolConstructions += 1;
      pgState.poolOptions.push(options);
    }

    on(): this {
      return this;
    }

    query(text: unknown): Promise<{ rows: never[] }> {
      pgState.queryTexts.push(typeof text === "string" ? text : String(text));
      if (pgState.queryError !== undefined) {
        return Promise.reject(pgState.queryError);
      }
      return Promise.resolve({ rows: [] });
    }

    end(): Promise<void> {
      pgState.poolEndCalls += 1;
      return Promise.resolve();
    }
  }

  class FakeClient {
    constructor(_options: unknown) {
      pgState.clientConstructions += 1;
    }
  }

  return {
    Client: FakeClient,
    Pool: FakePool,
    default: { Client: FakeClient, Pool: FakePool },
  };
});

const { resolveConfig } = await import("../../src/config/schema.js");
const { registerDiffCommands } = await import("../../src/cli/diff.js");
const { buildSchemaPlanningContext, resolveGenerationSourceDefaults } = await import(
  "../../src/planner/context.js"
);
const { astStatements } = await import("../../src/sql/ast.js");
const { parseSqlAst } = await import("../../src/sql/parser.js");
const { syncMigrations } = await import("../../src/workflow/sync.js");
const { Command } = await import("commander");

const catalogPassword = ["catalog", "credential", "value"].join("-");
const validMigration = `CREATE SCHEMA app;
CREATE TABLE app.accounts (id bigint);
`;
const replayNeutralMigration = `DO $$
BEGIN
  CREATE ROLE source_matrix_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;
`;

interface Fixture {
  config: ReturnType<typeof resolveConfig>;
  migrationsSource: string;
  root: string;
}

type SourceSide = "from" | "to";

let previousDatabaseUrl: string | undefined;

beforeEach(() => {
  previousDatabaseUrl = process.env.SUPASCHEMA_DATABASE_URL;
  pgState.clientConstructions = 0;
  pgState.poolConstructions = 0;
  pgState.poolEndCalls = 0;
  pgState.poolOptions.length = 0;
  pgState.queryError = undefined;
  pgState.queryTexts.length = 0;
});

afterEach(() => {
  process.exitCode = undefined;
  if (previousDatabaseUrl === undefined) {
    delete process.env.SUPASCHEMA_DATABASE_URL;
  } else {
    process.env.SUPASCHEMA_DATABASE_URL = previousDatabaseUrl;
  }
});

async function createFixture(migrationSql: string | null = validMigration): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "supa-generation-sources-"));
  await mkdir(join(root, "migrations"));
  await mkdir(join(root, "schemas"));
  if (migrationSql !== null) {
    await writeFile(join(root, "migrations", "20260101000000_source.sql"), migrationSql);
  }
  return {
    config: resolveConfig({ migrationsDir: "migrations", schemaPaths: ["schemas"] }),
    migrationsSource: "migrations:migrations",
    root,
  };
}

function databaseSource(): string {
  const url = new URL("postgresql://example.test/app");
  url.username = "catalog_reader";
  url.password = catalogPassword;
  return `database:${url.toString()}`;
}

function modelForSide(
  context: Awaited<ReturnType<typeof buildSchemaPlanningContext>>,
  side: SourceSide
) {
  return side === "from" ? context.from : context.to;
}

async function isReadOnlyCatalogQuery(query: string): Promise<boolean> {
  const parsed = await parseSqlAst(query);
  return (
    parsed.diagnostics.every((item) => item.severity !== "error") &&
    astStatements(parsed.ast, query).every((statement) => statement.tag === "SelectStmt")
  );
}

describe("generation source planning", () => {
  it.each([
    { kind: "database", side: "from" },
    { kind: "database", side: "to" },
    { kind: "migrations", side: "from" },
    { kind: "migrations", side: "to" },
  ] satisfies {
    kind: "database" | "migrations";
    side: SourceSide;
  }[])("extracts an explicit $kind source on the $side side", async ({ kind, side }) => {
    const fixture = await createFixture();
    const source = kind === "database" ? databaseSource() : fixture.migrationsSource;
    const context = await buildSchemaPlanningContext({
      checkMigrationBaseline: false,
      config: fixture.config,
      cwd: fixture.root,
      from: side === "from" ? source : "empty:",
      to: side === "to" ? source : "empty:",
    });

    const model = modelForSide(context, side);
    expect(context.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(model?.source).toBe(source);
    expect(model?.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(pgState.poolConstructions).toBe(kind === "database" ? 1 : 0);
    expect(pgState.poolEndCalls).toBe(kind === "database" ? 1 : 0);
    expect(pgState.clientConstructions).toBe(0);
  });

  it("extracts a database to-source with read-only catalog access and no apply client", async () => {
    const fixture = await createFixture();

    const context = await buildSchemaPlanningContext({
      checkMigrationBaseline: false,
      config: fixture.config,
      cwd: fixture.root,
      from: fixture.migrationsSource,
      to: databaseSource(),
    });

    expect(context.to?.diagnostics).toEqual([]);
    expect(pgState.queryTexts.length).toBeGreaterThan(0);
    const querySafety = await Promise.all(pgState.queryTexts.map(isReadOnlyCatalogQuery));
    expect(querySafety.every(Boolean)).toBe(true);
    expect(pgState.poolConstructions).toBe(1);
    expect(pgState.poolEndCalls).toBe(1);
    expect(pgState.clientConstructions).toBe(0);
  });

  it.each([{ side: "from" }, { side: "to" }] satisfies {
    side: SourceSide;
  }[])("surfaces migrations replay diagnostics on the $side side", async ({ side }) => {
    const fixture = await createFixture("ALTER TABLE app.missing ADD COLUMN id bigint;\n");
    const context = await buildSchemaPlanningContext({
      checkMigrationBaseline: false,
      config: fixture.config,
      cwd: fixture.root,
      from: side === "from" ? fixture.migrationsSource : "empty:",
      to: side === "to" ? fixture.migrationsSource : "empty:",
    });

    const model = modelForSide(context, side);
    const codes = [
      ...context.diagnostics.map((item) => item.code),
      ...(model?.diagnostics.map((item) => item.code) ?? []),
    ];
    expect(codes).toContain("SUPA_REPLAY_ORDER_GAP");
    expect(pgState.poolConstructions).toBe(0);
    expect(pgState.clientConstructions).toBe(0);
  });

  it("redacts credentials from catalog extraction diagnostics", async () => {
    const fixture = await createFixture();
    const source = databaseSource();
    pgState.queryError = new Error(`catalog connection failed for ${source}`);

    const context = await buildSchemaPlanningContext({
      checkMigrationBaseline: false,
      config: fixture.config,
      cwd: fixture.root,
      from: source,
      to: "empty:",
    });

    const diagnostics = context.from?.diagnostics ?? [];
    const serialized = JSON.stringify(diagnostics);
    expect(diagnostics.map((item) => item.code)).toContain("SUPA_CATALOG_EXTRACT_FAILED");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(catalogPassword);
    expect(pgState.poolEndCalls).toBe(1);
  });

  it("does not connect from an ambient database URL during zero-source resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-generation-defaults-"));
    process.env.SUPASCHEMA_DATABASE_URL = databaseSource().slice("database:".length);

    const resolved = await resolveGenerationSourceDefaults(
      { cwd: root },
      resolveConfig({ migrationsDir: "migrations", schemaPaths: ["schemas"] }),
      async () => false
    );

    expect(resolved.from).toBe("empty:");
    expect(resolved.to).toBe("dir:schemas");
    expect(resolved.diagnostics).toEqual([]);
    expect(pgState.poolConstructions).toBe(0);
    expect(pgState.clientConstructions).toBe(0);
  });

  it.each([
    { command: "plan", reverse: false },
    { command: "plan", reverse: true },
    { command: "diff", reverse: false },
    { command: "diff", reverse: true },
  ] satisfies {
    command: "diff" | "plan";
    reverse: boolean;
  }[])("routes database and migrations through $command with reverse=$reverse", async ({
    command,
    reverse,
  }) => {
    const fixture = await createFixture(replayNeutralMigration);
    const migrationsSource = `migrations:${join(fixture.root, "migrations")}`;
    const database = databaseSource();
    const from = reverse ? migrationsSource : database;
    const to = reverse ? database : migrationsSource;
    const diagnostics: string[] = [];
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined, writeOut: () => undefined });
    registerDiffCommands(program, {
      cliVersion: "test",
      configPath: () => undefined,
      loadCliConfig: () => Promise.resolve(fixture.config),
      printDiagnostics: (items) => diagnostics.push(...items.map((item) => item.code)),
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await program.parseAsync([
        "node",
        "supaschema",
        command,
        "--from",
        from,
        "--to",
        to,
        ...(command === "diff" ? ["--out", "stdout"] : []),
      ]);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    expect(process.exitCode).toBeUndefined();
    expect(diagnostics).toEqual([]);
    expect(pgState.poolConstructions).toBe(1);
    expect(pgState.poolEndCalls).toBe(1);
    expect(pgState.clientConstructions).toBe(0);
  });

  it.each([{ reverse: false }, { reverse: true }] satisfies {
    reverse: boolean;
  }[])("routes database and migrations through no-target sync with reverse=$reverse", async ({
    reverse,
  }) => {
    const fixture = await createFixture(replayNeutralMigration);
    const migrationsDirectory = join(fixture.root, "migrations");
    const outputDirectory = join(fixture.root, "output-migrations");
    await mkdir(outputDirectory);
    const database = databaseSource();
    const migrations = `migrations:${migrationsDirectory}`;
    const from = reverse ? migrations : database;
    const to = reverse ? database : migrations;
    const result = await syncMigrations({
      config: {
        migrationsDir: outputDirectory,
        schemaPaths: [join(fixture.root, "schemas")],
        sync: { targets: {} },
        workflow: {
          migration_sync: "manual",
          rls_safety: "disabled",
          type_generation: "disabled",
          type_safety: "disabled",
          zod_generation: "disabled",
        },
      },
      directory: outputDirectory,
      from,
      pipeline: true,
      to,
    });

    expect(result.applied).toBe(false);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.report).toContain("nothing to sync");
    expect(pgState.poolConstructions).toBe(1);
    expect(pgState.poolEndCalls).toBe(1);
    expect(pgState.clientConstructions).toBe(0);
  });
});
