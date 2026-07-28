# Safety gates — scan, contract regressions, and CI

The workflow lanes prove a migration _replays_. This lane proves it is _safe to ship_: schema hygiene, lock risk, RLS coverage, grant exposure, and generated-contract regressions.

## Rule-pack scan

```bash
supaschema scan                                   # declarative tree, text report
supaschema scan --from <source>                   # explicit source
supaschema scan --contract-usage src              # also scan TypeScript contract usage
supaschema scan --reporter json                   # text | json | github | sarif
```

Four rule packs run against the schema model:

| Pack | Codes | Covers |
| --- | --- | --- |
| `hygiene` | `HYG001` | naming and shape hygiene, including non-snake-case identifiers |
| `migration-safety` | `LOCK001` | lock-risk operations in the planned change |
| `rls` | `SEC001`–`SEC008` | row-level security coverage and policy exposure |
| `grants` | `PRIV001`–`PRIV003` | privilege breadth and default-ACL exposure |

Rules inspect the model and return diagnostics; they never mutate plans or SQL. Fix findings in the declarative schema source.

Results are scored and graded: `A` ≥ 90, `B` ≥ 80, `C` ≥ 70, `D` ≥ 60, otherwise `F`. Errors weigh more than warnings. Use the grade as a trend signal, not as a substitute for reading the diagnostics.

## Generated-contract usage

`--contract-usage <dir>` scans TypeScript under that directory for application code working around the generated contracts instead of fixing the model:

| Code | Meaning |
| --- | --- |
| `SUPA_SCAN_CONTRACT_ASSERTION` | a type assertion papering over a contract type |
| `SUPA_SCAN_CONTRACT_OVERRIDE_TYPES` | locally redeclared contract types |
| `SUPA_SCAN_CONTRACT_RUNTIME_COPY` | a runtime copy of a generated contract |
| `SUPA_SCAN_CONTRACT_IMPORT_RENAME` | a contract import renamed to obscure its origin |
| `SUPA_SCAN_CONTRACT_RETURNS` | a return type diverging from the contract |
| `SUPA_SCAN_CONTRACT_USAGE_PARSE` | the usage file could not be parsed |

These are the detector for the rule that consumers must not hide missing model coverage behind casts, aliases, or copied contracts. When one fires, fix the schema source, the supported extension model, the extractor, or the typegen owner — not the consumer.

## Type-contract regression gate

```bash
supaschema type-contract                                  # --from defaults to git:HEAD
supaschema type-contract --from <source> --to <source>
supaschema type-contract --enforce                        # exit 2 on breaking changes
supaschema type-contract --reporter github
```

Compares the generated type contract between two schema sources and reports breaking changes: `SUPA_TYPE_COLUMN_REMOVED`, `SUPA_TYPE_COLUMN_TYPE_CHANGED`, `SUPA_TYPE_COLUMN_NULLABILITY_CHANGED`, `SUPA_TYPE_ENUM_REMOVED`, `SUPA_TYPE_ENUM_VALUE_REMOVED`. `types` regenerates contracts; this proves the regeneration does not break consumers.

`contracts export` / `contracts diff` are the stored-artifact form of the same idea — see [migrate.md](migrate.md).

## Deploy-safety policy

Two config fields decide whether safety findings block a deploy. Both default to `report_only`.

| Field | Governs | Values |
| --- | --- | --- |
| `workflow.rls_safety` | RLS and grant rule-pack diagnostics | `disabled`, `report_only`, `deploy_blocking` |
| `workflow.type_safety` | type-contract diagnostics | `disabled`, `report_only`, `deploy_blocking` |

`disabled` short-circuits the gate entirely and returns an empty result. `deploy_blocking` turns findings into a refusal at the `sync` deploy-safety step. Do not lower a policy to make a deploy pass — fix the finding in its owning source, or get an explicit decision from the user to change the policy.

## CI wiring

`check`, `scan`, and `type-contract` all accept `--reporter text | json | github | sarif`. Use `github` for inline annotations and `sarif` for code-scanning upload.

A representative gate:

```bash
supaschema scan --contract-usage src --reporter json
supaschema diff --fail-on-diff --quiet
supaschema check --reporter github
supaschema verify
```

Exit codes are uniform across commands — see the table in [SKILL.md](../SKILL.md). `diff --fail-on-diff` returning 3 means drift; `check` and `scan` returning 2 mean diagnostics contained errors.
