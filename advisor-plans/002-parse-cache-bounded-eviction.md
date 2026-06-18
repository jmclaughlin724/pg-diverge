# Plan 002: Replace the parse-cache full-clear with bounded (LRU/FIFO) eviction

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f27746f..HEAD -- src/sql/parser.ts` — if it changed since this plan was written, compare the "Current state" excerpt below against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f27746f`, 2026-06-15

## Why this matters

`src/sql/parser.ts` memoizes parsed ASTs in a process-lifetime `Map` keyed by `sha256(sql)`, capped at 2000 entries. When the cap is hit the code calls `parseCache.clear()` — it drops the **entire** cache. On a large schema (>2000 distinct SQL strings — realistic for Supabase projects with many functions/views/tables), the cache fills and flushes mid-extraction, so the finalize pass (which re-parses each object's SQL for hashing) and the typegen pass restart cold and pay the full libpg-query cost again. A bounded eviction that drops only the oldest entries keeps recently-used parses warm through the extract → finalize → typegen sequence, preserving the cache's benefit on exactly the large schemas where it matters most.

## Current state

`src/sql/parser.ts`, lines 19-39 (the cache and its eviction):

```ts
const parseCacheLimit = 2000;
const parseCache = new Map<string, ParsedSqlAst>();
let cachedParser: PgParser | undefined | null;

export async function parseSql(
  sql: string,
  file?: string
): Promise<Diagnostic[]> {
  return (await parseSqlAst(sql, file)).diagnostics;
}

export async function parseSqlAst(
  sql: string,
  file?: string
): Promise<ParsedSqlAst> {
  const cacheKey = sha256(sql);
  const cached = parseCache.get(cacheKey);
  if (cached) {
    return withLocation(cached, file);
  }
  const outcome = await parseUncached(sql);
  if (parseCache.size >= parseCacheLimit) {
    parseCache.clear(); // <-- full flush; the bug
  }
  parseCache.set(cacheKey, outcome);
  return withLocation(outcome, file);
}
```

Key facts:

- A JavaScript `Map` already preserves **insertion order**, so the oldest keys are simply the first ones `Map.keys()` yields. You do not need a separate array to implement FIFO eviction.
- `withLocation(cached, file)` returns the cached `ParsedSqlAst` adjusted for the requesting file — eviction must not change what a cache _hit_ returns, only when entries are removed.
- The cache is correctness-neutral: it is a pure memo keyed by `sha256(sql)`. Evicting any entry only forces a re-parse; it never changes a result.

Repo conventions:

- Rule 07 (AST over regex) governs SQL _semantics_; this change is pure cache bookkeeping, no SQL parsing logic — no regex involved.
- NodeNext ESM `.js` import extensions.
- Apply fixes with `npm run format` (not `npm run lint fix`).

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npx vitest run tests/sql.test.ts tests/normalize.test.ts tests/ast-identity.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Apply fixes | `npm run format` | writes fixes |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `src/sql/parser.ts`
- `tests/sql.test.ts` (extend — or a new `tests/parse-cache.test.ts` if cleaner)

**Out of scope** (do NOT touch):

- The parse result shape (`ParsedSqlAst`), `parseUncached`, `loadParser`, `withLocation` — only the eviction policy changes.
- The `parseCacheLimit` value (2000) — keep it unless a STOP condition forces a discussion; this plan changes _how_ eviction happens, not the cap.

## Git workflow

- Branch: `advisor/002-parse-cache-eviction` off the default branch.
- Commit style: conventional commits (e.g. `perf(parser): bound parse-cache eviction instead of full clear`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the full clear with oldest-first eviction

In `parseSqlAst`, replace the `if (parseCache.size >= parseCacheLimit) { parseCache.clear(); }` block with eviction of the oldest entries. Because `Map` is insertion-ordered, deleting the first key(s) is FIFO. Evict a batch (e.g. ~20%) so eviction is amortized rather than per-insert once full:

```ts
if (parseCache.size >= parseCacheLimit) {
  // Evict the oldest entries (Map preserves insertion order) instead of
  // dropping the whole cache, so the extract -> finalize -> typegen passes
  // keep their recently-parsed objects warm on schemas larger than the cap.
  const evictCount = Math.max(1, Math.floor(parseCacheLimit * 0.2));
  let removed = 0;
  for (const key of parseCache.keys()) {
    parseCache.delete(key);
    removed += 1;
    if (removed >= evictCount) {
      break;
    }
  }
}
parseCache.set(cacheKey, outcome);
```

Optional true-LRU upgrade (only if you prefer it and it stays simple): on a cache **hit**, `delete` then `set` the key to move it to the most-recently-used end before returning. This makes eviction LRU rather than FIFO. Keep it only if it does not complicate the hit path; FIFO is sufficient and lower-risk.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Format and run the parser-adjacent tests

`npm run format`, then the targeted suites. Parsing results must be unchanged — only eviction timing differs.

**Verify**:

- `npm run lint` → exit 0
- `npx vitest run tests/sql.test.ts tests/normalize.test.ts tests/ast-identity.test.ts` → all pass
- `npm test` → all pass
- `npm run build` → exit 0

## Test plan

- Add a focused test (in `tests/sql.test.ts` or a new `tests/parse-cache.test.ts`) that:
  1. Parses a known SQL string, then parses it again and asserts the two results are consistent (cache hit returns the same AST shape).
  2. Drives more than `parseCacheLimit` distinct parses (generate distinct SQL strings in a loop, e.g. `create table t${i} (id int);`), then re-parses an **early** string and asserts it still parses correctly. With the old `clear()` this would simply re-parse (still correct), so the strongest assertion you can make portably is "results remain correct across the cap boundary" — the cache is an internal optimization, so assert correctness, not hit/miss counts, unless `parseCache` is exported for inspection (it is not — do not export it just for the test).
- If you want to assert eviction _bounds_, keep it behavior-only: after exceeding the cap, parsing still returns correct ASTs and does not throw.
- Verification: `npx vitest run <that file>` → all pass.

## Done criteria

ALL must hold:

- [x] `npm run typecheck` exits 0
- [x] `npm test` exits 0
- [x] `npm run lint` exits 0
- [x] `npm run build` exits 0
- [x] `grep -n "parseCache.clear()" src/sql/parser.ts` returns no matches
- [x] A test exercising the >cap path exists and passes
- [x] No files outside the in-scope list are modified (`git status`)
- [x] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Any existing parser/extract/normalize test fails — eviction must be result-neutral; a failure means the cache key or hit semantics were disturbed.
- You find the cache is consulted in a way where evicting an entry could change a _result_ (it should not — keys are `sha256(sql)` content hashes). If so, do not proceed; report it.

## Maintenance notes

- Future tuning of `parseCacheLimit` or the 20% eviction batch is safe — both are pure performance knobs.
- A reviewer should confirm the hit path (`if (cached) return withLocation(cached, file)`) is unchanged and that no result depends on an entry remaining cached.
- If memory pressure ever becomes a concern on very large schemas, this FIFO structure is the natural place to add a byte-size-aware bound; note it but do not build it now.
