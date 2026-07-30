import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  builtAt: string | null;
  commit: string | null;
  dirty: boolean | null;
  version: string;
}

export async function readBuildInfo(
  fallbackVersion = "0.0.0",
  stampUrl: URL = new URL("./build-info.json", import.meta.url)
): Promise<BuildInfo> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stampUrl, "utf8"));
    if (parsed === null || typeof parsed !== "object") {
      return fallbackBuildInfo(fallbackVersion);
    }
    return {
      builtAt: stringOrNull(Reflect.get(parsed, "builtAt")),
      commit: stringOrNull(Reflect.get(parsed, "commit")),
      dirty: booleanOrNull(Reflect.get(parsed, "dirty")),
      version: stringOrNull(Reflect.get(parsed, "version")) ?? fallbackVersion,
    };
  } catch {
    return fallbackBuildInfo(fallbackVersion);
  }
}

export function isUnreleasedBuild(info: BuildInfo): boolean {
  return info.version.includes("-") || info.dirty === true;
}

export function unreleasedBuildBanner(info: BuildInfo): string | null {
  if (!isUnreleasedBuild(info)) {
    return null;
  }
  const commit = info.commit === null ? "unknown commit" : info.commit.slice(0, 12);
  return `supaschema ${info.version} (${commit}) — unreleased build`;
}

export async function staleDistWarning(
  info: BuildInfo,
  packageRoot: string = fileURLToPath(new URL("../", import.meta.url))
): Promise<string | null> {
  if (info.builtAt === null) {
    return null;
  }
  const builtAtMs = Date.parse(info.builtAt);
  if (Number.isNaN(builtAtMs)) {
    return null;
  }
  const sourceRoot = join(packageRoot, "src");
  const sourceStat = await stat(sourceRoot).catch(() => null);
  if (sourceStat === null || !sourceStat.isDirectory()) {
    return null;
  }
  const newestSourceMs = await newestMtimeMs(sourceRoot);
  if (newestSourceMs <= builtAtMs) {
    return null;
  }
  return "SUPA_BUILD_STALE_DIST: compiled dist is older than src; run npm run build before trusting CLI behavior";
}

export async function emitBuildWarnings(info: BuildInfo): Promise<void> {
  if (process.env.SUPASCHEMA_SUPPRESS_BUILD_WARNING === "1" || process.argv.includes("--quiet")) {
    return;
  }
  const lines = [unreleasedBuildBanner(info), await staleDistWarning(info)].filter(
    (line): line is string => line !== null
  );
  for (const line of lines) {
    process.stderr.write(`${line}\n`);
  }
}

function fallbackBuildInfo(version: string): BuildInfo {
  return { builtAt: null, commit: null, dirty: null, version };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function newestMtimeMs(directory: string): Promise<number> {
  let newest = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtimeMs(path));
    } else {
      newest = Math.max(newest, (await stat(path)).mtimeMs);
    }
  }
  return newest;
}
