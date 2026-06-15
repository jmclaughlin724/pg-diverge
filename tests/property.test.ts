import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { migrationNameSlug } from "../src/cli-defaults.js";
import { redactSecrets } from "../src/diagnostics.js";
import { extractObjectsFromSql } from "../src/sql/extract.js";
import { splitSqlStatements } from "../src/sql/split.js";

const identifier = fc.stringMatching(/^[a-z][a-z0-9_]{0,16}$/u).map((value) => `q${value}`);
const passwordPattern = /^[A-Za-z0-9%_-]{8,24}$/u;
const slugPattern = /^[a-z0-9_]*$/u;

function randomizeCase(value: string, flips: boolean[]): string {
  return [...value]
    .map((char, index) => (flips[index % flips.length] ? char.toUpperCase() : char))
    .join("");
}

async function objectHash(sql: string): Promise<string> {
  const result = await extractObjectsFromSql(sql);
  const errors = result.diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(`expected extraction to succeed: ${JSON.stringify(errors)}`);
  }
  const hash = result.objects[0]?.hash;
  if (!hash) {
    throw new Error(`no object extracted from: ${sql}`);
  }
  return hash;
}

describe("property: AST identity", () => {
  it("hashes are invariant under keyword casing for arbitrary identifiers", async () => {
    await fc.assert(
      fc.asyncProperty(
        identifier,
        identifier,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 24 }),
        async (table, column, flips) => {
          const lower = await objectHash(`create table app.${table} (${column} integer);`);
          const shouted = await objectHash(
            `${randomizeCase("create table", flips)} app.${table} (${column} INTEGER);`
          );
          expect(shouted).toBe(lower);
        }
      ),
      { numRuns: 25 }
    );
  });

  it("quoting an already-folded identifier never changes identity", async () => {
    await fc.assert(
      fc.asyncProperty(identifier, async (table) => {
        const bare = await objectHash(`CREATE TABLE app.${table} (id integer);`);
        const quoted = await objectHash(`CREATE TABLE app."${table}" (id integer);`);
        expect(quoted).toBe(bare);
      }),
      { numRuns: 25 }
    );
  });
});

describe("property: statement splitting", () => {
  it("never splits on semicolons inside string literals", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 30 }), { minLength: 1, maxLength: 8 }),
        (values) => {
          const statements = values.map((value) => `SELECT '${value.replaceAll("'", "''")}' AS v`);
          const split = splitSqlStatements(`${statements.join(";\n")};`);
          expect(split).toHaveLength(statements.length);
        }
      )
    );
  });
});

describe("property: migration name slugs", () => {
  it("always produces bounded lowercase snake case and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (value) => {
        const slug = migrationNameSlug(value);
        expect(slug).toMatch(slugPattern);
        expect(slug.length).toBeLessThanOrEqual(60);
        expect(migrationNameSlug(slug)).toBe(slug);
      })
    );
  });
});

describe("property: secret redaction", () => {
  it("never leaks a URL password through diagnostics text", () => {
    const password = fc.stringMatching(passwordPattern);
    fc.assert(
      fc.property(identifier, password, (user, secret) => {
        const text = `connection failed for postgresql://${user}:${secret}@db.example.com:5432/app`;
        const redacted = redactSecrets(text);
        expect(redacted).not.toContain(secret);
        expect(redacted).toContain(user);
      })
    );
  });
});
