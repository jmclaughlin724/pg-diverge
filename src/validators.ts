import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveConfig } from "./config.js";
import type { CheckOptions, Diagnostic } from "./core.js";
import { diagnostic } from "./diagnostics.js";

const execFileAsync = promisify(execFile);

type ValidatorSpec = {
  args: string[];
  command: string;
};

type CommandError = Error & {
  code?: unknown;
  stderr?: unknown;
  stdout?: unknown;
};

export async function runConfiguredValidators(
  sql: string,
  options: CheckOptions = {},
): Promise<Diagnostic[]> {
  const config = resolveConfig(options.config);
  const externalValidators = config.validators.filter(
    (validator) => validator !== "internal-parser",
  );
  if (externalValidators.length === 0) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  const tempRoot = await mkdtemp(join(tmpdir(), "supaschema-"));
  const tempFile = join(tempRoot, "migration.sql");
  try {
    await writeFile(tempFile, sql);
    for (const validator of externalValidators) {
      const spec = validatorSpec(validator);
      if (!spec) {
        diagnostics.push(
          diagnostic("SUPA_VALIDATOR_UNKNOWN", "error", `unknown validator "${validator}"`, {
            hint: "Supported validators: internal-parser, squawk, squawk-cli, pgls, postgres-language-server, sqlfluff, pg-formatter.",
          }),
        );
        continue;
      }
      diagnostics.push(...(await runValidator(validator, spec, tempFile, options.cwd)));
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true }).catch(() => undefined);
  }
  return diagnostics;
}
function validatorSpec(name: string): ValidatorSpec | undefined {
  switch (name) {
    case "squawk":
    case "squawk-cli":
      return { args: [], command: "squawk" };
    case "pgls":
    case "@postgres-language-server/cli":
    case "postgres-language-server":
      return {
        args: [
          "check",
          "--disable-db",
          "--reporter=summary",
          "--max-diagnostics=none",
          "--no-errors-on-unmatched",
        ],
        command: "postgres-language-server",
      };
    case "sqlfluff":
      return { args: ["lint", "--dialect", "postgres"], command: "sqlfluff" };
    case "pg-formatter":
    case "pgformatter":
      return { args: ["--check"], command: "pg-formatter" };
    default:
      return undefined;
  }
}
async function runValidator(
  name: string,
  spec: ValidatorSpec,
  path: string,
  cwd = process.cwd(),
): Promise<Diagnostic[]> {
  try {
    await execFileAsync(spec.command, [...spec.args, path], {
      cwd,
      maxBuffer: 1024 * 1024 * 10,
      timeout: 30_000,
    });
    return [];
  } catch (error) {
    if (isMissingExecutable(error)) {
      return [
        diagnostic("SUPA_VALIDATOR_UNAVAILABLE", "error", `validator "${name}" is not available`, {
          hint: `Install the validator or remove "${name}" from validators.`,
        }),
      ];
    }
    return [
      diagnostic("SUPA_VALIDATOR_FAILED", "error", `validator "${name}" reported diagnostics`, {
        hint: commandOutput(error),
      }),
    ];
  }
}
function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function commandOutput(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const output = [readStringProperty(error, "stdout"), readStringProperty(error, "stderr")]
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  return output.length > 0 ? output.slice(0, 2000) : String(error);
}
function readStringProperty(value: unknown, property: "stdout" | "stderr"): string {
  const record = value as CommandError;
  const output = record[property];
  return typeof output === "string" ? output : "";
}
