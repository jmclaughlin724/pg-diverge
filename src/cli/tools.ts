import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import type { SupaschemaConfig } from "../config/schema.js";
import {
  contractDrift,
  isSchemaContract,
  type SchemaContract,
  toContract,
} from "../contract/schema.js";
import { formatDiagnostics, hasErrors } from "../diagnostics/diagnostics.js";
import { renderDoctorReport, runDoctor } from "../doctor.js";
import { extractSourceModel } from "../source/extract.js";
import { defaultTreeSource } from "../source/resolve.js";
import { generateTypeContracts } from "../typegen/contracts.js";
import { collectSchemaShapes } from "../typegen/model.js";
import type { Diagnostic } from "../types.js";

export interface ToolCommandContext {
  configPath: () => string | undefined;
  loadCliConfig: () => Promise<SupaschemaConfig>;
  printDiagnostics: (diagnostics: Diagnostic[]) => void;
  resolveCliDatabaseUrl: (explicit?: string) => Promise<string | undefined>;
  resolveCliDatabaseUrlInfo: (explicit?: string) => Promise<{
    lane: string;
    url: string | undefined;
  }>;
}

export function registerToolCommands(program: Command, context: ToolCommandContext): void {
  program
    .command("doctor")
    .option("--database-url <url>", "database URL to probe (default: normal resolution order)")
    .option("--json", "print the report as JSON")
    .description(
      "Diagnose the environment: parser and target compatibility, config discovery, database/catalog readiness, migration replay and baseline selection, history, and the declarative tree."
    )
    .action(async (options: { databaseUrl?: string; json?: boolean }) => {
      const config = await context.loadCliConfig();
      const database = await context.resolveCliDatabaseUrlInfo(options.databaseUrl);
      const configPath = context.configPath();
      const report = await runDoctor(config, {
        ...(options.databaseUrl === undefined ? {} : { databaseUrl: options.databaseUrl }),
        ...(configPath === undefined ? {} : { configPath }),
        databaseUrlLane: database.lane,
        ...(database.url === undefined ? {} : { resolvedDatabaseUrl: database.url }),
      });
      process.stdout.write(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderDoctorReport(report)
      );
      if (!report.healthy) {
        process.exitCode = 2;
      }
    });

  program
    .command("types")
    .option("--from <source>", "source to type (default: the config schema tree)")
    .option("--out <file|stdout>", "TypeScript output path (default: config.typesFile)")
    .option("--check", "verify on-disk contracts match regenerated output without writing")
    .description("Generate configured TypeScript and Zod contracts from a schema source.")
    .action(async (options: { check?: boolean; from?: string; out?: string }) => {
      if (options.check === true && options.out !== undefined) {
        process.stderr.write("types: --check cannot be combined with --out\n");
        process.exitCode = 1;
        return;
      }
      const config = await context.loadCliConfig();
      const result = await generateTypeContracts({
        check: options.check === true,
        config,
        honorWorkflowPolicy: options.from === undefined && options.out === undefined,
        ...(options.from === undefined ? {} : { source: options.from }),
        ...(options.out === undefined ? {} : { out: options.out }),
      });
      context.printDiagnostics(result.diagnostics);
      if (hasErrors(result.diagnostics)) {
        process.exitCode = 2;
        return;
      }
      if (result.stdout !== undefined) {
        process.stdout.write(result.stdout);
        return;
      }
      if (options.check === true) {
        for (const line of result.skipped) {
          process.stdout.write(`${line}\n`);
        }
        process.stdout.write(`types: contracts up to date (${result.checked.length} checked)\n`);
        return;
      }
      process.stdout.write(`${result.written.join("\n")}\n`);
    });

  program
    .command("fingerprint")
    .requiredOption("--from <source>", "source to fingerprint")
    .description(
      "Print only the model fingerprint for a source — two sources with equal fingerprints have identical schemas."
    )
    .action(async (options: { from: string }) => {
      const config = await context.loadCliConfig();
      const model = await extractSourceModel(options.from, { config });
      context.printDiagnostics(model.diagnostics);
      if (hasErrors(model.diagnostics)) {
        process.exitCode = 2;
        return;
      }
      process.stdout.write(`${model.fingerprint}\n`);
    });

  const contracts = program.command("contracts").description("Export and diff schema contracts.");

  contracts
    .command("export")
    .option("--from <source>", "source to export (default: the config schema tree)")
    .option("--out <file|stdout>", "contract output path", "stdout")
    .description("Export a JSON schema contract from a schema source.")
    .action(async (options: { from?: string; out?: string }) => {
      const config = await context.loadCliConfig();
      const source = options.from ?? defaultTreeSource(config);
      const contract = await buildContract(config, source);
      await writeJson(options.out ?? "stdout", contract);
    });

  contracts
    .command("diff")
    .requiredOption("--from <file>", "previous contract JSON file")
    .option("--to <source>", "candidate schema source (default: the config schema tree)")
    .description("Diff a stored schema contract against a schema source.")
    .action(async (options: { from: string; to?: string }) => {
      const config = await context.loadCliConfig();
      const source = options.to ?? defaultTreeSource(config);
      const previous = await readContractFile(options.from);
      const next = await buildContract(config, source);
      const diagnostics = contractDrift(previous, next);
      if (diagnostics.length > 0) {
        process.stdout.write(`${formatDiagnostics(diagnostics)}\n`);
      }
      if (hasErrors(diagnostics)) {
        process.exitCode = 2;
      }
    });

  program
    .command("completion")
    .argument("<shell>", "bash, zsh, or fish")
    .description(
      "Print a shell completion script (eval or save it into your shell's completion path)."
    )
    .action((shell: string) => {
      const script = completionScript(shell, program);
      if (script === undefined) {
        process.stderr.write(`unsupported shell "${shell}"; use bash, zsh, or fish\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(script);
    });
}

async function buildContract(
  config: SupaschemaConfig,
  source: string | undefined
): Promise<SchemaContract> {
  const model = await extractSourceModel(source ?? defaultTreeSource(config), { config });
  if (hasErrors(model.diagnostics)) {
    throw new Error(formatDiagnostics(model.diagnostics));
  }
  return toContract(await collectSchemaShapes(model));
}

async function readContractFile(path: string): Promise<SchemaContract> {
  const parsed: unknown = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
  if (!isSchemaContract(parsed)) {
    throw new Error(`${path} is not a schema contract`);
  }
  return parsed;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (path === "stdout") {
    process.stdout.write(json);
    return;
  }
  const outPath = resolve(process.cwd(), path);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json);
  process.stdout.write(`${outPath}\n`);
}

function completionScript(shell: string, program: Command): string | undefined {
  const commands = program.commands.map((command) => command.name()).sort();
  const list = commands.join(" ");
  switch (shell) {
    case "bash":
      return [
        "_supaschema_completions() {",
        '  if [ "$COMP_CWORD" -eq 1 ]; then',
        `    COMPREPLY=($(compgen -W "${list}" -- "\${COMP_WORDS[1]}"))`,
        "  fi",
        "}",
        "complete -F _supaschema_completions supaschema",
        "",
      ].join("\n");
    case "zsh":
      return [
        "#compdef supaschema",
        "_supaschema() {",
        "  local -a commands",
        `  commands=(${commands.map((name) => `'${name}'`).join(" ")})`,
        "  if (( CURRENT == 2 )); then",
        "    _describe 'command' commands",
        "  fi",
        "}",
        '_supaschema "$@"',
        "",
      ].join("\n");
    case "fish":
      return `${commands
        .map((name) => `complete -c supaschema -n "__fish_use_subcommand" -a ${name}`)
        .join("\n")}\n`;
    default:
      return;
  }
}

const esc = String.fromCharCode(27);
const ansi = {
  green: `${esc}[32m`,
  red: `${esc}[31m`,
  reset: `${esc}[0m`,
  yellow: `${esc}[33m`,
};

export function colorEnabled(): boolean {
  return process.env.NO_COLOR === undefined && process.stdout.isTTY === true;
}

export type SummaryTone = "create" | "drop" | "blocked" | "plain";

export function colorizeSummaryLine(line: string, tone: SummaryTone): string {
  if (!colorEnabled() || tone === "plain") {
    return line;
  }
  const color = summaryColor(tone);
  return `${color}${line}${ansi.reset}`;
}

function summaryColor(tone: Exclude<SummaryTone, "plain">): string {
  if (tone === "blocked") {
    return ansi.yellow;
  }
  if (tone === "drop") {
    return ansi.red;
  }
  return ansi.green;
}
