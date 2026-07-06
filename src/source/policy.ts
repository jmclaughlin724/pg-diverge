import { parseRuntimeSource, RuntimeSourceKind } from "../config/contract.js";
import type { Diagnostic } from "../core.js";
import { diagnostic } from "../diagnostics.js";

export function migrationsTypegenOnlyDiagnostic(
  lane: string,
  side: "from" | "source" | "to",
  source: string
): Diagnostic | undefined {
  if (parseRuntimeSource(source)?.kind !== RuntimeSourceKind.Migrations) {
    return;
  }
  const subject = side === "source" ? `${lane} source` : `${lane} ${side}-source`;
  return diagnostic(
    "SUPA_SOURCE_MIGRATIONS_TYPEGEN_ONLY",
    "error",
    `${subject} uses migration-history replay`,
    {
      hint: `Use migrations:<dir> only with supaschema types --source. Use git:<ref>, dir:<path>, dump:<file>, catalog:<file>, or empty: for ${lane}.`,
    }
  );
}
