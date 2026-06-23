import { extractCatalogModel } from "./catalog/extract.js";
import type { Diagnostic } from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { extractObjectsFromSql } from "./sql/extract.js";

export interface SelfCheckOptions {
  databaseUrl: string;
}

export interface SelfCheckResult {
  checkedObjects: number;
  diagnostics: Diagnostic[];
  mismatches: number;
}

export async function selfCheckCatalog(options: SelfCheckOptions): Promise<SelfCheckResult> {
  const model = await extractCatalogModel({
    databaseUrl: options.databaseUrl,
    source: "selfcheck",
  });
  const diagnostics: Diagnostic[] = [...model.diagnostics];
  const script = [...model.objects]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((object) => `${object.sql};`)
    .join("\n\n");

  const reparsed = await extractObjectsFromSql(script, {
    config: { managedSchemas: [] },
    file: "selfcheck:rendered",
  });
  diagnostics.push(...reparsed.diagnostics.filter((item) => item.severity === "error"));
  const catalogByKey = new Map(model.objects.map((object) => [object.key, object]));
  const reparsedByKey = new Map(reparsed.objects.map((object) => [object.key, object]));
  let mismatches = 0;
  for (const [key, object] of catalogByKey) {
    const other = reparsedByKey.get(key);
    if (!other) {
      mismatches += 1;
      diagnostics.push(
        diagnostic(
          "SUPA_SELFCHECK_MISSING",
          "error",
          `catalog object ${key} disappeared when its rendered SQL was re-extracted`,
          { ref: object.ref, statement: object.sql }
        )
      );
      continue;
    }
    if (other.hash !== object.hash) {
      mismatches += 1;
      diagnostics.push(
        diagnostic(
          "SUPA_SELFCHECK_HASH_MISMATCH",
          "error",
          `catalog object ${key} hashes differently after re-extraction; cross-lane identity would report a false change`,
          { ref: object.ref, statement: object.sql }
        )
      );
    }
  }
  for (const [key, object] of reparsedByKey) {
    if (!catalogByKey.has(key)) {
      mismatches += 1;
      diagnostics.push(
        diagnostic(
          "SUPA_SELFCHECK_UNEXPECTED",
          "error",
          `re-extraction produced ${key}, which the catalog model does not contain`,
          { ref: object.ref, statement: object.sql }
        )
      );
    }
  }
  return { checkedObjects: catalogByKey.size, diagnostics, mismatches };
}
