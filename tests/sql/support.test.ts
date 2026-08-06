import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractObjectsFromSql } from "../../src/sql/extract.js";
import {
  modeledObjectSupport,
  sourceIntentStatementTags,
  unsupportedStatementSupport,
} from "../../src/sql/support.js";

function tableRowLabels(markdown: string): string[] {
  const labels: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const [, firstCell] = trimmed.split("|");
    if (firstCell !== undefined) {
      labels.push(firstCell.trim());
    }
  }
  return labels;
}

describe("SQL support contract", () => {
  it("keeps the public support matrix aligned with the executable contract", async () => {
    const [docs, sources] = await Promise.all([
      readFile("docs/reference/support-matrix.mdx", "utf8"),
      readFile("docs/concepts/sources.mdx", "utf8"),
    ]);
    const documentedRows = tableRowLabels(docs);

    expect(docs).toContain("src/sql/support.ts");
    for (const label of new Set(modeledObjectSupport.map((item) => item.label))) {
      expect(documentedRows).toContain(label);
    }
    for (const boundary of unsupportedStatementSupport.map((item) => item.boundary)) {
      expect(documentedRows).toContain(boundary);
    }
    expect(sourceIntentStatementTags).toContain("GrantRoleStmt");
    expect(docs).toContain("Role-membership `GRANT` and `REVOKE`");
    expect(docs).toContain(
      "Existing reviewed migrations replay only `ALTER POLICY` definition changes for `TO`, `USING`, and `WITH CHECK`"
    );
    expect(sources).toContain("absent non-ignored targets for supported `ALTER` statements");
    expect(sources).toContain("Policy renames remain unsupported");
  });

  it("reports documented unsupported boundaries from parser tags", async () => {
    const extracted = await extractObjectsFromSql(`
      CREATE PUBLICATION app_pub FOR TABLE app.accounts;
      CREATE SUBSCRIPTION app_sub CONNECTION 'host=x' PUBLICATION app_pub;
      CREATE EVENT TRIGGER app_ddl ON ddl_command_start EXECUTE FUNCTION app.f();
      CREATE COLLATION app.case_insensitive (provider = icu, locale = "und-u-ks-level2");
      CREATE USER MAPPING FOR app_user SERVER files OPTIONS (user 'x');
      CREATE STATISTICS app.accounts_stats ON id FROM app.accounts;
      CREATE RULE accounts_insert AS ON INSERT TO app.accounts DO INSTEAD NOTHING;
      SECURITY LABEL FOR selinux ON SCHEMA app IS 'x';
    `);

    const messages = extracted.diagnostics.map((item) => item.message).join("\n");
    expect(messages).toContain("unsupported declarative boundary (Publications/subscriptions)");
    expect(messages).toContain("unsupported declarative boundary (Event triggers)");
    expect(messages).toContain("unsupported declarative boundary (Collations)");
    expect(messages).toContain(
      "unsupported declarative boundary (Credential and cluster-scoped objects)"
    );
    expect(messages).toContain(
      "unsupported declarative boundary (Rules/statistics/security labels)"
    );
  });
});
