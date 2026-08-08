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

async function extractFrom(
  source: string,
  prefix: string,
  filename: string,
  sql = interleavedRegrant
): Promise<SchemaModel> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(directory, filename), sql);
  return extractSourceModel(`${source}:${directory}`);
}

function grantsForUser(model: SchemaModel, grantee: string) {
  return model.objects.filter(
    (object) => object.ref.kind === "grant" && object.metadata.grantee === grantee
  );
}

const partialRegrant = [
  "CREATE SCHEMA app;",
  "CREATE TABLE app.t (id bigint);",
  "GRANT SELECT, INSERT ON TABLE app.t TO app_user;",
  "REVOKE SELECT ON TABLE app.t FROM app_user;",
  "GRANT SELECT ON TABLE app.t TO app_user;",
].join("\n");

const plainGrant = [
  "CREATE SCHEMA app;",
  "CREATE TABLE app.t (id bigint);",
  "GRANT SELECT, INSERT ON TABLE app.t TO app_user;",
].join("\n");

const trailingRevoke = [
  "CREATE SCHEMA app;",
  "CREATE TABLE app.t (id bigint);",
  "GRANT INSERT, UPDATE ON TABLE app.t TO app_user;",
  "REVOKE SELECT, UPDATE ON TABLE app.t FROM app_user;",
  "GRANT UPDATE ON TABLE app.t TO app_user;",
  "REVOKE UPDATE ON TABLE app.t FROM app_user;",
  "REVOKE INSERT, UPDATE ON TABLE app.t FROM app_user;",
].join("\n");

describe("interleaved partial revoke/regrant net resolution", () => {
  it("collapses the regrant sequence to a single net grant in the declarative model", async () => {
    const declared = await extractFrom("dir", "supa-grant-dir-", "schema.sql");

    const grants = grantsForUser(declared, "authenticated");
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
    expect(grantsForUser(replayed, "authenticated")).toHaveLength(1);
  });

  it("agrees between declarative and replayed sources for a partial revoke/regrant", async () => {
    const declared = await extractFrom("dir", "supa-partial-dir-", "schema.sql", partialRegrant);
    const replayed = await extractFrom(
      "migrations",
      "supa-partial-mig-",
      "20240101000000_init.sql",
      partialRegrant
    );
    const plain = await extractFrom("dir", "supa-partial-plain-dir-", "schema.sql", plainGrant);

    expect(replayed.fingerprint).toBe(declared.fingerprint);
    expect(declared.fingerprint).toBe(plain.fingerprint);

    const grants = grantsForUser(declared, "app_user");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.metadata.verb).toBe("GRANT");
    expect(grants[0]?.metadata.privileges).toEqual(["INSERT", "SELECT"]);
  });

  it("applies trailing revokes after an intermediate regrant", async () => {
    const declared = await extractFrom("dir", "supa-trailing-dir-", "schema.sql", trailingRevoke);
    const replayed = await extractFrom(
      "migrations",
      "supa-trailing-mig-",
      "20240101000000_init.sql",
      trailingRevoke
    );

    expect(replayed.fingerprint).toBe(declared.fingerprint);
    expect(grantsForUser(replayed, "app_user")).toHaveLength(0);
  });
});
