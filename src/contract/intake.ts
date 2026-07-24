import { diagnostic } from "../diagnostics/diagnostics.js";
import { hasUnredactedSecret } from "../redaction.js";
import type { Diagnostic } from "../types.js";

const MAX_INTAKE_DEPTH = 64;

export interface IntakeOptions {
  label: string;

  requiredKeys: readonly string[];
}

export function validateIntake(payload: unknown, options: IntakeOptions): Diagnostic[] {
  if (!isRecord(payload)) {
    return [
      diagnostic(
        "SUPA_INTAKE_MALFORMED",
        "error",
        `${options.label} payload must be a JSON object`
      ),
    ];
  }
  const diagnostics: Diagnostic[] = [];
  for (const key of options.requiredKeys) {
    if (!Object.hasOwn(payload, key)) {
      diagnostics.push(
        diagnostic(
          "SUPA_INTAKE_MISSING_SCOPE",
          "error",
          `${options.label} payload is missing required field "${key}"`
        )
      );
    }
  }
  const scan = secretScan(payload, 0);
  if (scan === "too-deep") {
    diagnostics.push(
      diagnostic(
        "SUPA_INTAKE_MALFORMED",
        "error",
        `${options.label} payload nesting exceeds the ${MAX_INTAKE_DEPTH}-level intake limit`
      )
    );
  } else if (scan === "secret") {
    diagnostics.push(
      diagnostic(
        "SUPA_INTAKE_SECRET",
        "error",
        `${options.label} payload contains a secret-shaped value; redact credentials before submitting`
      )
    );
  }
  return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ScanResult = "clean" | "secret" | "too-deep";

function secretScan(value: unknown, depth: number): ScanResult {
  if (depth > MAX_INTAKE_DEPTH) {
    return "too-deep";
  }
  if (typeof value === "string") {
    return hasUnredactedSecret(value) ? "secret" : "clean";
  }
  if (Array.isArray(value)) {
    return scanMany(value, depth);
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (hasUnredactedSecret(key)) {
        return "secret";
      }
    }
    return scanMany(Object.values(value), depth);
  }
  return "clean";
}

function scanMany(values: readonly unknown[], depth: number): ScanResult {
  let result: ScanResult = "clean";
  for (const item of values) {
    const scan = secretScan(item, depth + 1);
    if (scan === "secret") {
      return "secret";
    }
    if (scan === "too-deep") {
      result = "too-deep";
    }
  }
  return result;
}
