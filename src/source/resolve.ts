import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SupaschemaConfig } from "../config/schema.js";
import type { CurrentBaselineFingerprints } from "../migrations/status.js";
import { redactSecrets } from "../redaction.js";
import { extractSourceModel } from "./extract.js";

const execFileAsync = promisify(execFile);

export interface ResolvedSources {
  from: string;
  notice: string | undefined;
  to: string;
}

export function defaultTreeSource(config: SupaschemaConfig): string {
  return `dir:${config.schemaPaths[0] ?? "database/schemas"}`;
}

export function resolveMigrationsDir(
  flagValue: string | undefined,
  config: SupaschemaConfig
): string {
  return flagValue ?? config.migrationsDir;
}

export async function resolveSourceDefaults(
  options: { from?: string; to?: string },
  config: SupaschemaConfig,
  resolveDbUrl: () => Promise<string | undefined>,
  gitHeadExists: () => Promise<boolean> = defaultGitHeadExists
): Promise<ResolvedSources> {
  const defaulted: string[] = [];
  const to = options.to ?? defaultTreeSource(config);
  if (options.to === undefined) {
    defaulted.push(`--to ${to}`);
  }
  let from = options.from;
  if (from === undefined) {
    if (config.sources.from === "auto") {
      if (await gitHeadExists()) {
        from = "git:HEAD";
      } else {
        const databaseUrl = await resolveDbUrl();
        if (databaseUrl === undefined) {
          from = "empty:";
        } else {
          from = `database:${databaseUrl}`;
        }
      }
    } else {
      from = config.sources.from;
    }
    defaulted.push(`--from ${redactSecrets(from)}`);
  }
  const notice =
    defaulted.length > 0 ? `defaults: ${defaulted.join(" · ")} (flags override)\n` : undefined;
  return { from, notice, to };
}

export async function currentBaselineFingerprints(
  config: SupaschemaConfig,
  cwd: string = process.cwd()
): Promise<CurrentBaselineFingerprints> {
  const head = (await defaultGitHeadExists())
    ? await sourceFingerprint("git:HEAD", config, cwd)
    : undefined;
  const tree = await sourceFingerprint(defaultTreeSource(config), config, cwd);
  return {
    ...(head === undefined ? {} : { head }),
    ...(tree === undefined ? {} : { tree }),
  };
}

async function sourceFingerprint(
  source: string,
  config: SupaschemaConfig,
  cwd: string
): Promise<string | undefined> {
  try {
    return (await extractSourceModel(source, { config, cwd })).fingerprint;
  } catch {
    // Invalid fallback sources are ignored while resolving alternatives.
  }
}

export async function defaultGitHeadExists(): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}
