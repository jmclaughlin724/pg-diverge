import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import type { SupaschemaConfig } from "./config.js";
import { contractDrift, toContract } from "./contract-registry.js";
import { pullContract, pushContract } from "./contract-registry-client.js";
import type { Diagnostic } from "./core.js";
import { formatDiagnostics, hasErrors } from "./diagnostics.js";
import { renderDoctorReport, runDoctor } from "./doctor.js";
import { isSchemaContract, type SchemaContract } from "./schema-contract.js";
import { extractSourceModel } from "./source.js";
import { defaultTreeSource } from "./source-resolve.js";
import { generateTypeContracts } from "./typegen-contracts.js";
import { collectSchemaShapes } from "./typegen-model.js";

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
      "Diagnose the environment: Node version, parser, config, URL resolution, database reachability, CREATEDB capability, migrations history, and the declarative tree."
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
    .description(
      "Generate TypeScript types and Zod validators straight from the PostgreSQL schema tree — no database, no introspection, no applied migrations required."
    )
    .action(async (options: { from?: string; out?: string }) => {
      const config = await context.loadCliConfig();
      const result = await generateTypeContracts({
        config,
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

  const contracts = program
    .command("contracts")
    .description("Export, diff, push, and pull schema contracts.");

  contracts
    .command("export")
    .option("--from <source>", "source to export (default: the config schema tree)")
    .option("--out <file|stdout>", "contract output path", "stdout")
    .description("Export a JSON schema contract from a schema source.")
    .action(async (options: { from?: string; out?: string }) => {
      const config = await context.loadCliConfig();
      const contract = await buildContract(config, options.from);
      await writeJson(options.out ?? "stdout", contract);
    });

  contracts
    .command("diff")
    .requiredOption("--from <file>", "previous contract JSON file")
    .option("--to <source>", "candidate schema source (default: the config schema tree)")
    .description("Diff a stored schema contract against a schema source.")
    .action(async (options: { from: string; to?: string }) => {
      const config = await context.loadCliConfig();
      const previous = await readContractFile(options.from);
      const next = await buildContract(config, options.to);
      const diagnostics = contractDrift(previous, next);
      if (diagnostics.length > 0) {
        process.stdout.write(`${formatDiagnostics(diagnostics)}\n`);
      }
      if (hasErrors(diagnostics)) {
        process.exitCode = 2;
      }
    });

  contracts
    .command("push")
    .requiredOption("--registry-url <url>", "contract registry base URL")
    .requiredOption("--repo <owner/repo>", "repo bound to the license token")
    .option("--name <name>", "contract name", "main")
    .option("--from <source>", "source to export and push (default: the config schema tree)")
    .option(
      "--license-env <name>",
      "environment variable containing the license token",
      "SUPASCHEMA_LICENSE"
    )
    .description("Push a schema contract to the hosted registry.")
    .action(
      async (options: {
        from?: string;
        licenseEnv: string;
        name: string;
        registryUrl: string;
        repo: string;
      }) => {
        const config = await context.loadCliConfig();
        const contract = await buildContract(config, options.from);
        await pushContract({
          contract,
          fetchImpl: globalThis.fetch,
          license: licenseFromEnv(options.licenseEnv),
          name: options.name,
          registryUrl: options.registryUrl,
          repo: options.repo,
        });
        process.stdout.write("contract stored\n");
      }
    );

  contracts
    .command("pull")
    .requiredOption("--registry-url <url>", "contract registry base URL")
    .requiredOption("--repo <owner/repo>", "repo bound to the license token")
    .option("--name <name>", "contract name", "main")
    .option("--out <file|stdout>", "contract output path", "stdout")
    .option(
      "--license-env <name>",
      "environment variable containing the license token",
      "SUPASCHEMA_LICENSE"
    )
    .description("Pull a schema contract from the hosted registry.")
    .action(
      async (options: {
        licenseEnv: string;
        name: string;
        out?: string;
        registryUrl: string;
        repo: string;
      }) => {
        const contract = await pullContract({
          fetchImpl: globalThis.fetch,
          license: licenseFromEnv(options.licenseEnv),
          name: options.name,
          registryUrl: options.registryUrl,
          repo: options.repo,
        });
        await writeJson(options.out ?? "stdout", contract);
      }
    );

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

function licenseFromEnv(name: string): string {
  const token = process.env[name];
  if (token === undefined || token.length === 0) {
    throw new Error(`${name} must contain a license token`);
  }
  return token;
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
