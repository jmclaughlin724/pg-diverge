import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/schema.js";
import { runDoctor } from "../src/doctor.js";

async function doctorProject(migrationSql: string) {
  const cwd = await mkdtemp(join(tmpdir(), "supa-doctor-"));
  await mkdir(join(cwd, "migrations"));
  await mkdir(join(cwd, "schemas"));
  await writeFile(join(cwd, "migrations", "20260101000000_initial.sql"), migrationSql);
  await writeFile(
    join(cwd, "schemas", "app.sql"),
    "CREATE SCHEMA app;\nCREATE TABLE app.accounts (id bigint);\n"
  );
  return {
    config: resolveConfig({
      migrationsDir: "migrations",
      schemaPaths: ["schemas"],
      sources: { from: "auto" },
    }),
    cwd,
  };
}

describe("doctor readiness", () => {
  it("skips migration replay checks while the migrations directory is empty", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "supa-doctor-"));
    await mkdir(join(cwd, "migrations"));
    await mkdir(join(cwd, "schemas"));
    await writeFile(join(cwd, "schemas", "app.sql"), "CREATE SCHEMA app;\n");
    const config = resolveConfig({
      migrationsDir: "migrations",
      schemaPaths: ["schemas"],
      sources: { from: "auto" },
    });

    const report = await runDoctor(config, { cwd });
    const replay = report.checks.find((check) => check.name === "migration replay");

    expect(replay).toMatchObject({ status: "skip" });
  });

  it("accepts equivalent migrations source spellings as the automatic baseline", async () => {
    const fixture = await doctorProject(
      "CREATE SCHEMA app;\nCREATE TABLE app.accounts (id bigint);\n"
    );
    const config = resolveConfig({
      migrationsDir: "migrations",
      schemaPaths: ["schemas"],
      sources: { from: "migrations:./migrations" },
    });

    const report = await runDoctor(config, { cwd: fixture.cwd });
    const baseline = report.checks.find((check) => check.name === "automatic baseline");

    expect(baseline).toMatchObject({ status: "pass" });
  });

  it("reports parser grammar, replay fingerprint, and automatic migration adoption", async () => {
    const fixture = await doctorProject(
      "CREATE SCHEMA app;\nCREATE TABLE app.accounts (id bigint);\n"
    );

    const report = await runDoctor(fixture.config, { cwd: fixture.cwd });

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining("AST 180004"),
        name: "sql parser",
        status: "pass",
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "build identity",
        status: "pass",
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining("fingerprint"),
        name: "migration replay",
        status: "pass",
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining("recovery baseline"),
        name: "automatic baseline",
        status: "pass",
      })
    );
  });

  it("fails once at the migration replay owner and names the recovery lane", async () => {
    const fixture = await doctorProject("ALTER TABLE app.missing ADD COLUMN id bigint;\n");

    const report = await runDoctor(fixture.config, { cwd: fixture.cwd });
    const replay = report.checks.find((check) => check.name === "migration replay");
    const baseline = report.checks.find((check) => check.name === "automatic baseline");

    expect(report.healthy).toBe(false);
    expect(replay).toMatchObject({ status: "fail" });
    expect(replay?.detail).toContain("SUPA_REPLAY_ORDER_GAP");
    expect(baseline).toMatchObject({ status: "fail" });
    expect(baseline?.detail).toContain("migrations:migrations");
  });
});
