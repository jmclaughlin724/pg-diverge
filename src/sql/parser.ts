import { diagnostic } from "../diagnostics/diagnostics.js";
import { sha256 } from "../hash.js";
import type { Diagnostic } from "../types.js";

type PgParser = (sql: string) => unknown | Promise<unknown>;

interface PgParserModule {
  default?: PgParserModule;
  parse?: PgParser;
  parseQuery?: PgParser;
  parseSync?: PgParser;
  scan?: PgParser;
}

export interface ParsedSqlAst {
  ast?: unknown;
  diagnostics: Diagnostic[];
}

export interface ScannedSql {
  diagnostics: Diagnostic[];
  tokens?: unknown[];
}

const parseCacheLimit = 2000;
const parseCache = new Map<string, ParsedSqlAst>();
const scanCache = new Map<string, ScannedSql>();
let cachedParser: PgParser | undefined | null;
let cachedScanner: PgParser | undefined | null;

export async function parseSql(sql: string, file?: string): Promise<Diagnostic[]> {
  return (await parseSqlAst(sql, file)).diagnostics;
}

export async function parseSqlAst(sql: string, file?: string): Promise<ParsedSqlAst> {
  const cacheKey = sha256(sql);
  const cached = parseCache.get(cacheKey);
  if (cached) {
    return withFile(cached, file);
  }
  const outcome = await parseUncached(sql);
  evictIfFull(parseCache);
  parseCache.set(cacheKey, outcome);
  return withFile(outcome, file);
}

export async function scanSql(sql: string, file?: string): Promise<ScannedSql> {
  const cacheKey = sha256(sql);
  const cached = scanCache.get(cacheKey);
  if (cached) {
    return withFile(cached, file);
  }
  const outcome = await scanUncached(sql);
  evictIfFull(scanCache);
  scanCache.set(cacheKey, outcome);
  return withFile(outcome, file);
}

function evictIfFull<T>(cache: Map<string, T>): void {
  if (cache.size < parseCacheLimit) {
    return;
  }
  const evictCount = Math.max(1, Math.floor(parseCacheLimit * 0.2));
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed += 1;
    if (removed >= evictCount) {
      return;
    }
  }
}

async function parseUncached(sql: string): Promise<ParsedSqlAst> {
  try {
    const parser = await loadParser();
    if (!parser) {
      return {
        diagnostics: [
          diagnostic(
            "SUPA_PARSE_UNAVAILABLE",
            "warning",
            "libpg-query did not expose a parser",
            {}
          ),
        ],
      };
    }
    return {
      ast: await parser(sql),
      diagnostics: [],
    };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic("SUPA_PARSE_ERROR", "error", errorMessage(error), {
          statement: sql,
        }),
      ],
    };
  }
}

async function loadParser(): Promise<PgParser | undefined> {
  if (cachedParser !== undefined && cachedParser !== null) {
    return cachedParser;
  }
  if (cachedParser === null) {
    return;
  }
  const module = await import("libpg-query");
  const parser = findParser(module);
  cachedParser = parser ?? null;
  return parser;
}

async function scanUncached(sql: string): Promise<ScannedSql> {
  try {
    const scanner = await loadScanner();
    if (!scanner) {
      return {
        diagnostics: [
          diagnostic(
            "SUPA_SCAN_UNAVAILABLE",
            "warning",
            "libpg-query did not expose a scanner",
            {}
          ),
        ],
      };
    }
    const result = await scanner(sql);
    const tokens = result && typeof result === "object" ? Reflect.get(result, "tokens") : undefined;
    return Array.isArray(tokens) ? { tokens, diagnostics: [] } : { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic("SUPA_SCAN_ERROR", "error", errorMessage(error), { statement: sql }),
      ],
    };
  }
}

async function loadScanner(): Promise<PgParser | undefined> {
  if (cachedScanner !== undefined && cachedScanner !== null) {
    return cachedScanner;
  }
  if (cachedScanner === null) {
    return;
  }
  const module = await import("libpg-query");
  const scanner = findScanner(module);
  cachedScanner = scanner ?? null;
  return scanner;
}

function withFile<T extends { diagnostics: Diagnostic[] }>(
  outcome: T,
  file: string | undefined
): T {
  if (!file || outcome.diagnostics.length === 0) {
    return outcome;
  }
  return {
    ...outcome,
    diagnostics: outcome.diagnostics.map((item) => ({ ...item, file })),
  };
}

function findParser(module: PgParserModule): PgParser | undefined {
  const candidates = [
    module.parse,
    module.parseQuery,
    module.parseSync,
    module.default?.parse,
    module.default?.parseQuery,
    module.default?.parseSync,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate;
    }
  }
}

function findScanner(module: PgParserModule): PgParser | undefined {
  const candidates = [module.scan, module.default?.scan];
  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate;
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
