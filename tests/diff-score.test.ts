import { describe, expect, it } from "vitest";
import { scoreDiffOutput } from "../src/benchmark/diff-score.js";
import { realisticFixtureManifest } from "../src/benchmark/fixtures.js";

const manifest = [
  { change: "create", key: "table:app.audit_events" },
  { change: "change", key: "table:app.entity_001" },
  { change: "change", key: "enum:app.entity_status" },
];

describe("diff output accuracy scoring", () => {
  it("scores a complete minimal migration at f1 = 1", async () => {
    const score = await scoreDiffOutput(
      `SET lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS app.audit_events (id bigint NOT NULL);
ALTER TABLE app.entity_001 ADD COLUMN IF NOT EXISTS external_ref text DEFAULT ''::text NOT NULL;
ALTER TYPE app.entity_status ADD VALUE IF NOT EXISTS 'archived';`,
      manifest
    );

    expect(score.missed).toEqual([]);
    expect(score.excess).toEqual([]);
    expect(score.f1).toBe(1);
  });

  it("drops precision when untouched objects are rewritten", async () => {
    const score = await scoreDiffOutput(
      `CREATE TABLE IF NOT EXISTS app.audit_events (id bigint NOT NULL);
ALTER TABLE app.entity_001 ADD COLUMN external_ref text;
ALTER TYPE app.entity_status ADD VALUE 'archived';
DROP TABLE IF EXISTS app.entity_004;
CREATE TABLE app.entity_004 (id bigint NOT NULL);`,
      manifest
    );

    expect(score.recall).toBe(1);
    expect(score.excess).toEqual(["table:app.entity_004"]);
    expect(score.precision).toBeLessThan(1);
  });

  it("drops recall when an intended change is missing", async () => {
    const score = await scoreDiffOutput(
      "CREATE TABLE IF NOT EXISTS app.audit_events (id bigint NOT NULL);",
      manifest
    );

    expect(score.missed).toEqual(["enum:app.entity_status", "table:app.entity_001"]);
    expect(score.recall).toBeCloseTo(1 / 3);
  });

  it("penalizes precision for a destructive rewrite of a manifest table", async () => {
    const score = await scoreDiffOutput(
      `CREATE TABLE IF NOT EXISTS app.audit_events (id bigint NOT NULL);
DROP TABLE app.entity_001;
CREATE TABLE app.entity_001 (id bigint NOT NULL, external_ref text);
ALTER TYPE app.entity_status ADD VALUE IF NOT EXISTS 'archived';`,
      manifest
    );

    expect(score.recall).toBe(1);
    expect(score.excess).toEqual(["table:app.entity_001"]);
    expect(score.precision).toBeLessThan(1);
  });

  it("counts spurious drops and materialized-view rewrites as excess", async () => {
    const score = await scoreDiffOutput(
      `CREATE TABLE IF NOT EXISTS app.audit_events (id bigint NOT NULL);
ALTER TABLE app.entity_001 ADD COLUMN external_ref text;
ALTER TYPE app.entity_status ADD VALUE 'archived';
DROP INDEX app.entity_004_idx;
DROP POLICY entity_004_select ON app.entity_004;
DROP FUNCTION app.touch_updated_at();
DROP MATERIALIZED VIEW app.entity_stats;
CREATE MATERIALIZED VIEW app.entity_stats AS SELECT 1 AS n;`,
      manifest
    );

    expect(score.recall).toBe(1);
    expect(score.excess).toEqual([
      "function:app.touch_updated_at",
      "index:app.entity_004_idx",
      "materialized-view:app.entity_stats",
      "policy:app.entity_004_select:entity_004",
    ]);
    expect(score.precision).toBeLessThan(1);
  });

  it("scores an empty diff against an empty manifest at f1 = 1", async () => {
    const score = await scoreDiffOutput("SET lock_timeout = '5s';", []);

    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.f1).toBe(1);
  });

  it("classifies guard DO blocks whose identifiers contain keyword substrings", async () => {
    const score = await scoreDiffOutput(
      `DO $supaschema$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conname = 'audit_then_events_check'
  ) THEN
    ALTER TABLE ONLY app.audit_events ADD CONSTRAINT audit_then_events_check CHECK (id > 0);
  END IF;
END
$supaschema$;`,
      [{ change: "create", key: "constraint:app.audit_then_events_check:audit_events" }]
    );

    expect(score.missed).toEqual([]);
    expect(score.f1).toBe(1);
  });

  it("classifies DO blocks without an IF guard via the BEGIN/END body", async () => {
    const score = await scoreDiffOutput(
      `DO $$
BEGIN
  ALTER TABLE app.entity_001 ADD COLUMN external_ref text;
END
$$;`,
      [{ change: "change", key: "table:app.entity_001" }]
    );

    expect(score.missed).toEqual([]);
    expect(score.f1).toBe(1);
  });

  it("classifies statements inside supaschema guard DO blocks", async () => {
    const score = await scoreDiffOutput(
      `DO $supaschema$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conname = 'audit_events_tenant_id_fkey'
  ) THEN
    ALTER TABLE ONLY app.audit_events ADD CONSTRAINT audit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES app.tenants (id);
  END IF;
END
$supaschema$;`,
      [{ change: "create", key: "constraint:app.audit_events_tenant_id_fkey:audit_events" }]
    );

    expect(score.missed).toEqual([]);
    expect(score.f1).toBe(1);
  });

  it("builds a manifest sized to the fixture", () => {
    const entries = realisticFixtureManifest(16);
    expect(entries.some((entry) => entry.key === "table:app.audit_events")).toBe(true);
    expect(entries.filter((entry) => entry.key.startsWith("table:app.entity_")).length).toBe(5);
  });
});
