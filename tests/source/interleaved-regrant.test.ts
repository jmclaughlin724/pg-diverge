import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSourceModel } from "../../src/source/extract.js";
import type { SchemaModel } from "../../src/types.js";

const interleavedRegrant = [
  "CREATE SCHEMA app;",
  "CREATE TABLE app.t (id bigint);",
  "GRANT SELECT, INSERT ON TABLE app.t TO authenticated;",
  "REVOKE SELECT ON TABLE app.t FROM authenticated;",
  "GRANT SELECT ON TABLE app.t TO authenticated;",
  "REVOKE INSERT ON TABLE app.t FROM authenticated;",
  "GRANT INSERT ON TABLE app.t TO authenticated;",
].join("\n");

async function extractFrom(source: string, prefix: string, filename: string): Promise<SchemaModel> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(directory, filename), interleavedRegrant);
  return extractSourceModel(`${source}:${directory}`);
}

function grantsForAuthenticated(model: SchemaModel) {
  return model.objects.filter(
    (object) => object.ref.kind === "grant" && object.metadata.grantee === "authenticated"
  );
}

describe("interleaved partial revoke/regrant net resolution", () => {
  it("collapses the regrant sequence to a single net grant in the declarative model", async () => {
    const declared = await extractFrom("dir", "supa-grant-dir-", "schema.sql");

    const grants = grantsForAuthenticated(declared);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.metadata.privileges).toEqual(["INSERT", "SELECT"]);
  });

  it("agrees between declarative and replayed sources for interleaved regrants", async () => {
    const declared = await extractFrom("dir", "supa-grant-cmp-dir-", "schema.sql");
    const replayed = await extractFrom(
      "migrations",
      "supa-grant-cmp-mig-",
      "20240101000000_init.sql"
    );

    expect(replayed.fingerprint).toBe(declared.fingerprint);
    expect(grantsForAuthenticated(replayed)).toHaveLength(1);
  });
});
