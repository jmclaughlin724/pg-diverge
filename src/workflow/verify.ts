import type { Diagnostic } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import { latestLineage } from "../migrations/lineage.js";

export async function checkSyncLineageChain(
  fromFingerprint: string,
  toFingerprint: string,
  directory: string
): Promise<Diagnostic[]> {
  const latest = await latestLineage(directory);
  if (!latest) {
    return [];
  }
  if (latest.from === fromFingerprint && latest.to === toFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_DUPLICATE",
        "error",
        "a pending supaschema migration already covers this exact from/to transition",
        {
          file: latest.file,
          hint: "Apply or remove the pending migration before running sync again.",
        }
      ),
    ];
  }
  if (latest.to !== fromFingerprint) {
    return [
      diagnostic(
        "SUPA_DIFF_LINEAGE_GAP",
        "error",
        "the newest pending supaschema migration does not chain into the next schema diff",
        {
          file: latest.file,
          hint: "Apply or remove the pending migration before generating another one.",
        }
      ),
    ];
  }
  return [];
}
