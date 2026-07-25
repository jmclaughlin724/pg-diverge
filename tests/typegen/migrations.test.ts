import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/schema.js";
import { generateTypeContracts } from "../../src/typegen/contracts.js";

async function writeMigrations(files: [string, string][]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "supa-typegen-migrations-"));
  for (const [name, sql] of files) {
    await writeFile(join(directory, name), sql);
  }
  return directory;
}

describe("typegen from migrations source", () => {
  it("generates table and enum contracts from migration history without a database", async () => {
    const directory = await writeMigrations([
      [
        "20240101000000_create.sql",
        `CREATE SCHEMA app;
CREATE TYPE app.status AS ENUM ('draft', 'active');
CREATE TABLE app.only_history (
  id bigint GENERATED ALWAYS AS IDENTITY,
  status app.status NOT NULL DEFAULT 'draft'
);`,
      ],
      [
        "20240102000000_alter.sql",
        `ALTER TABLE app.only_history ADD COLUMN title text NOT NULL;
ALTER TYPE app.status ADD VALUE IF NOT EXISTS 'archived';`,
      ],
    ]);

    const result = await generateTypeContracts({
      config: resolveConfig(),
      out: "stdout",
      source: `migrations:${directory}`,
    });

    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.stdout).toContain("only_history");
    expect(result.stdout).toContain("title: string;");
    expect(result.stdout).toContain('status: Database["app"]["Enums"]["status"];');
    expect(result.stdout).toContain('"draft" | "active" | "archived"');
  });

  it("writes TypeScript constants without a Zod artifact when Zod generation is disabled", async () => {
    const directory = await writeMigrations([
      [
        "20240101000000_create.sql",
        `CREATE TYPE public.item_status AS ENUM ('draft', 'active');
CREATE TABLE public.items (
  id bigint GENERATED ALWAYS AS IDENTITY,
  status public.item_status NOT NULL
);`,
      ],
    ]);
    const output = await mkdtemp(join(tmpdir(), "supa-typegen-types-only-"));
    const typesFile = join(output, "database.types.ts");
    const zodFile = join(output, "database.zod.ts");

    const result = await generateTypeContracts({
      config: resolveConfig({
        typesFile,
        workflow: {
          type_generation: "create_or_refresh",
          zod_generation: "disabled",
        },
        zodFile,
      }),
      honorWorkflowPolicy: true,
      source: `migrations:${directory}`,
    });
    const types = await readFile(typesFile, "utf8");

    expect(result.written).toEqual([typesFile]);
    expect(types).toContain("export const Constants = {");
    expect(types).toContain('item_status: ["draft", "active"]');
    await expect(readFile(zodFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps zod-only output self-contained when type output is skipped", async () => {
    const directory = await writeMigrations([
      [
        "20240101000000_create.sql",
        `CREATE TYPE public.item_status AS ENUM ('draft', 'active');
CREATE TYPE public.item_metadata AS (label text);
CREATE TABLE public.items (
  id bigint GENERATED ALWAYS AS IDENTITY,
  payload jsonb NOT NULL,
  status public.item_status NOT NULL,
  metadata public.item_metadata
);`,
      ],
    ]);
    const output = await mkdtemp(join(tmpdir(), "supa-typegen-output-"));
    const typesFile = join(output, "database.types.ts");
    const zodFile = join(output, "database.zod.ts");

    const result = await generateTypeContracts({
      config: resolveConfig({
        sources: { from: `migrations:${directory}` },
        typesFile,
        workflow: {
          type_generation: "disabled",
          zod_generation: "create_or_refresh",
        },
        zodFile,
      }),
      honorWorkflowPolicy: true,
      source: `migrations:${directory}`,
    });
    const zod = await readFile(zodFile, "utf8");

    expect(result.written).toEqual([zodFile]);
    expect(result.skipped).toEqual([]);
    expect(zod).not.toContain("database.types");
    expect(zod).not.toContain("Database[");
    expect(zod).not.toContain("satisfies SupaschemaZodShape");
    expect(zod).toContain("export type Json =");
    expect(zod).toContain("export const JsonSchema: z.ZodType<Json>");
    expect(zod).toContain("export const SupaschemaZod: SupaschemaZodShape = {");
    expect(zod).toContain('status: z.lazy(() => SupaschemaZod["public"]["Enums"]["item_status"]),');
    expect(zod).toContain(
      'metadata: z.lazy(() => SupaschemaZod["public"]["CompositeTypes"]["item_metadata"]).nullable(),'
    );
  });

  it("allows the generated Zod type import module specifier to be configured", async () => {
    const directory = await writeMigrations([
      [
        "20240101000000_create.sql",
        `CREATE TYPE public.item_status AS ENUM ('draft', 'active');
CREATE TABLE public.items (
  id bigint GENERATED ALWAYS AS IDENTITY,
  payload jsonb NOT NULL,
  status public.item_status NOT NULL
);`,
      ],
    ]);
    const output = await mkdtemp(join(tmpdir(), "supa-typegen-import-"));
    const typesFile = join(output, "database.types.ts");
    const zodFile = join(output, "database.zod.ts");
    const baseConfig = {
      sources: { from: `migrations:${directory}` },
      typesFile,
      zodFile,
    };

    await generateTypeContracts({
      config: resolveConfig(baseConfig),
      source: `migrations:${directory}`,
    });
    expect(await readFile(zodFile, "utf8")).toContain(
      'import type { Database, Json } from "./database.types.js";'
    );

    await generateTypeContracts({
      config: resolveConfig({
        ...baseConfig,
        zodTypesImportPath: "@anilize/db/types",
      }),
      source: `migrations:${directory}`,
    });
    expect(await readFile(zodFile, "utf8")).toContain(
      'import type { Database, Json } from "@anilize/db/types";'
    );

    await generateTypeContracts({
      config: resolveConfig({
        ...baseConfig,
        workflow: {
          type_generation: "disabled",
          zod_generation: "create_or_refresh",
        },
        zodTypesImportPath: "@anilize/db/types",
      }),
      honorWorkflowPolicy: true,
      source: `migrations:${directory}`,
    });
    expect(await readFile(zodFile, "utf8")).toContain(
      'import type { Database, Json } from "@anilize/db/types";'
    );
  });
});
