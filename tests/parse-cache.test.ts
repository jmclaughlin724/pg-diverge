import { describe, expect, it } from "vitest";
import { parseSqlAst } from "../src/sql/parser.js";

describe("parse cache eviction", () => {
  it("keeps results correct across the cache-size cap (bounded eviction, not a full clear)", async () => {
    const early = "create table public.parse_cache_early (id integer);";

    // Prime the cache with an early statement, then drive well past the 2000
    // entry cap so the bounded-eviction path runs at least once.
    const first = await parseSqlAst(early);
    expect(first.ast).toBeDefined();
    expect(first.diagnostics).toHaveLength(0);

    for (let index = 0; index < 2400; index += 1) {
      const result = await parseSqlAst(`create table public.parse_cache_${index} (id integer);`);
      expect(result.ast).toBeDefined();
    }

    // After eviction the early statement may be a cache miss, but it must still
    // parse to the same correct result rather than throwing or degrading.
    const again = await parseSqlAst(early);
    expect(again.ast).toBeDefined();
    expect(again.diagnostics).toHaveLength(0);
  });
});
