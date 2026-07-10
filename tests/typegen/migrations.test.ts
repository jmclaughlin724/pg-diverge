import { mkdtemp, writeFile } from "node:fs/promises";
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
    expect(result.stdout).toContain("status: AppStatus;");
    expect(result.stdout).toContain('"draft" | "active" | "archived"');
  });
});
