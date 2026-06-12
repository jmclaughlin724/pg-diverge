import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import { defaultTreeSource } from "./cli-defaults.js";
import type { SupaschemaConfig } from "./config.js";
import type { Diagnostic } from "./core.js";
import { hasErrors } from "./diagnostics.js";
import { renderDoctorReport, runDoctor } from "./doctor.js";
import { extractSourceModel } from "./source.js";
import { generateDatabaseTypes } from "./typegen.js";

export interface ToolCommandContext {
  loadCliConfig: () => Promise<SupaschemaConfig>;
  printDiagnostics: (diagnostics: Diagnostic[]) => void;
  resolveCliDatabaseUrl: (explicit?: string) => Promise<string | undefined>;
}

export function registerToolCommands(program: Command, context: ToolCommandContext): void {
  program
    .command("doctor")
    .option("--database-url <url>", "database URL to probe (default: normal resolution order)")
    .option("--json", "print the report as JSON")
    .description(
      "Diagnose the environment: Node version, parser, config, URL resolution, database reachability, CREATEDB capability, migrations history, and the declarative tree.",
    )
    .action(async (options: { databaseUrl?: string; json?: boolean }) => {
      const config = await context.loadCliConfig();
      const report = await runDoctor(config, {
        ...(options.databaseUrl === undefined ? {} : { databaseUrl: options.databaseUrl }),
      });
      process.stdout.write(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : renderDoctorReport(report),
      );
      if (!report.healthy) {
        process.exitCode = 2;
      }
    });

  program
    .command("types")
    .option("--from <source>", "source to type (default: the config schema tree)")
    .option("--out <file|stdout>", "output path (default: config.typesFile)")
    .description(
      "Generate Supabase-compatible TypeScript types straight from the schema tree — no database, no introspection, no applied migrations required.",
    )
    .action(async (options: { from?: string; out?: string }) => {
      const config = await context.loadCliConfig();
      const source = options.from ?? defaultTreeSource(config);
      const model = await extractSourceModel(source, { config });
      context.printDiagnostics(model.diagnostics);
      if (hasErrors(model.diagnostics)) {
        process.exitCode = 2;
        return;
      }
      const types = await generateDatabaseTypes(model);
      const target = options.out ?? config.typesFile;
      if (target === "stdout") {
        process.stdout.write(types);
        return;
      }
      const outPath = resolve(process.cwd(), target);
      await writeFile(outPath, types);
      process.stdout.write(`${outPath}\n`);
    });

  program
    .command("fingerprint")
    .requiredOption("--from <source>", "source to fingerprint")
    .description(
      "Print only the model fingerprint for a source — two sources with equal fingerprints have identical schemas.",
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

  program
    .command("completion")
    .argument("<shell>", "bash, zsh, or fish")
    .description(
      "Print a shell completion script (eval or save it into your shell's completion path).",
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
      return undefined;
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

/**
 * Tone comes from the structured operation (kind/blocked), never from
 * re-classifying rendered text.
 */
export function colorizeSummaryLine(line: string, tone: SummaryTone): string {
  if (!colorEnabled() || tone === "plain") {
    return line;
  }
  const color = tone === "blocked" ? ansi.yellow : tone === "drop" ? ansi.red : ansi.green;
  return `${color}${line}${ansi.reset}`;
}
