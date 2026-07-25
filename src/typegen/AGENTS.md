# src/typegen - generated TypeScript and Zod contracts

## Contract

This directory emits generated database types, Zod schemas, and type-contract shapes from the schema model. It is included so declarative schema changes can close the consumer type loop through deterministic generated artifacts.

## Contents

- `model.ts` collects typed schema shapes from schema objects.
- `database.ts` renders TypeScript database types.
- `views.ts` resolves view column types from libpg-query AST node kinds plus modeled source facts.
- `zod.ts` renders Zod schemas.
- `check-constraints.ts` translates CHECK constraint ASTs into Zod refinement fragments; untranslatable expressions emit nothing, `NOT VALID` table checks stay off `Row`, domain checks remain column-local, and column-pair refinements guard with `== null` so SQL NULL and absent write keys pass. Libpg-query omits zero-valued protobuf fields (`0` arrives as `{ ival: {} }`), and `char_length` upper bounds count code points rather than UTF-16 units.
- `contracts.ts` emits type-contract files.

## Working Rules

- Keep generated output sorted and deterministic.
- Every CHECK refinement must be loose-or-exact for the client wire value PostgreSQL evaluates. Scalar integer and float8 targets allow bounds; typmod-free numeric allows only non-strict bounds; scalar equality allows only integer-family targets with safe integer literals. Float literals allow only non-strict bounds. Precision-sensitive numeric column pairs require wire-exact small-integer or float8 targets. Length allows typmod-free text/varchar/citext; `IN` additionally requires no explicit collation and excludes citext. Both exclude char/bpchar. Cast unwrapping requires scalar, typmod-free source and target types with the same text/varchar/citext base. Accumulate every unambiguously resolved inherited `CREATE DOMAIN` check through `VALUE`, attach only atomic column fragments to scalar columns, and fail loose on ambiguous domain hops.
- `migrations:` is a valid caller-selected typegen input. Typegen must still enter through `extractSourceModel`; do not read migration files directly from this directory. Planner use is limited to a matching configured migration corpus as the generation before-state, never the target, `verify`, or drift source.
- Type inference should use modeled facts, catalog/source metadata, and AST node-kind dispatch, not SQL text guesses or ad hoc wrapper probing when structured facts exist.
- Follow the current postgres-meta TypeScript generator for export shape, empty sentinels, scalar fallbacks, correlated RPC signatures, computed fields, and `SetofOptions`; keep Zod isolated under `SupaschemaZod`.
- Match postgres-meta RPC metadata exactly: name-sort arguments; retain named variadics; reject unnamed arrays and domains; restrict computed fields to eligible unnamed non-array relation rows; inline physical relation-return columns; keep computed SETOF fields singular; and use `Record<string, unknown>` for multiple OUT parameters.
- An `unknown` result is missing coverage only when modeled relation, function, extension, or expression facts should resolve. Preserve upstream's intentional `unknown` fallback for unsupported PostgreSQL scalars instead of adding local mappings.
- Preserve PostgreSQL output semantics: CTE sources shadow only unqualified range variables, schema-qualified relation references remain qualified, qualified stars expand only the matched source, `USING`/`NATURAL` joins merge join keys once, column alias lists apply positionally, visible function overloads beat builtin fallbacks, and predicate sublinks infer boolean results.
- Coordinate shape changes with contract diffs and generated snapshot tests.

## Verification

Run focused typegen/contract tests for changed output, then `npm run typecheck`.
