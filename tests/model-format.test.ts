import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_FORMAT_VERSION } from "../src/hash.js";
import { extractSourceModel } from "../src/source.js";

describe("model format versioning", () => {
  it("stamps extracted models with the current format version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pgd-format-"));
    await writeFile(join(directory, "schema.sql"), "CREATE TABLE app.items (id integer);");

    const model = await extractSourceModel(`dir:${directory}`);

    expect(model.formatVersion).toBe(MODEL_FORMAT_VERSION);
  });

  it("warns when a catalog snapshot has no or a different format version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pgd-format-snap-"));
    const snapshotPath = join(directory, "catalog.json");
    await writeFile(
      snapshotPath,
      JSON.stringify({ diagnostics: [], fingerprint: "stale", objects: [] }),
    );

    const model = await extractSourceModel(`catalog:${snapshotPath}`);

    expect(model.diagnostics.some((item) => item.code === "SUPA_CATALOG_SNAPSHOT_VERSION")).toBe(
      true,
    );
  });

  it("accepts snapshots stamped with the current format version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pgd-format-current-"));
    const snapshotPath = join(directory, "catalog.json");
    await writeFile(
      snapshotPath,
      JSON.stringify({
        diagnostics: [],
        fingerprint: "current",
        formatVersion: MODEL_FORMAT_VERSION,
        objects: [],
      }),
    );

    const model = await extractSourceModel(`catalog:${snapshotPath}`);

    expect(model.diagnostics).toEqual([]);
    expect(model.formatVersion).toBe(MODEL_FORMAT_VERSION);
  });
});
