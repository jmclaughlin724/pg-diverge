# Safety gates — scan, contract regressions, and CI

The workflow lanes prove a migration _replays_. This lane proves it is _safe to ship_: schema hygiene, lock risk, RLS coverage, grant exposure, and generated-contract regressions.

## Rule-pack scan

```bash
supaschema scan                                   # declarative tree, text report
supaschema scan --from <source>                   # explicit source
supaschema scan --contract-usage src              # also scan TypeScript contract usage
supaschema scan --reporter json                   # text | json | github | sarif
```

Three rule packs run against the schema model, plus the config-derived packs:

| Pack | Emitted codes | Covers |
| --- | --- | --- |
| `hygiene` | `SUPA_RULE_TABLE_NAMING` | naming and shape hygiene |
| `rls` | `SUPA_RULE_RLS_NO_POLICY`, `SUPA_RULE_POLICY_NO_RLS`, `SUPA_RULE_POLICY_MISSING_PREDICATE`, `SUPA_RULE_POLICY_AUTH_ROLE_DEPRECATED`, `SUPA_RULE_POLICY_AUTH_UID_UNWRAPPED`, `SUPA_RULE_EXPOSED_TABLE_WITHOUT_RLS`, `SUPA_RULE_SECDEF_SEARCH_PATH` | row-level security coverage and policy exposure |
| `grants` | `SUPA_RULE_GRANT_TO_PUBLIC`, `SUPA_RULE_GRANT_ALL_PRIVILEGES` | privilege breadth |
| config-derived | `SUPA_RULE_POLICY_MISSING_REQUIRED_COLUMN`, `SUPA_RULE_GRANT_UNDECLARED_ROLE` | required policy columns and declared roles from config |

These `SUPA_RULE_*` values are what appear in scan output and what `supaschema explain` accepts. Internal `Rule.id` values such as `HYG001` or `SEC001` are not emitted and cannot be used to match a report.

**Lock risk is not part of `scan`.** The `migration-safety` pack (`SUPA_RULE_DESTRUCTIVE_OP`) needs a plan, and `scan` supplies none — it is invoked by the diff pipeline instead. Route lock-risk review through `supaschema diff` or `supaschema plan`; a clean `scan` score says nothing about destructive-operation risk.

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

Compares the generated type contract between two schema sources and reports breaking changes: `SUPA_TYPE_TABLE_REMOVED`, `SUPA_TYPE_COLUMN_REMOVED`, `SUPA_TYPE_COLUMN_TYPE_CHANGED`, `SUPA_TYPE_COLUMN_NULLABILITY_CHANGED`, `SUPA_TYPE_ENUM_REMOVED`, `SUPA_TYPE_ENUM_VALUE_REMOVED`. `types` regenerates contracts; this proves the regeneration does not break consumers.

Without `--enforce` this command is report-only: it renders error-severity diagnostics and still exits 0. Use `--enforce` in CI whenever a breaking contract change must fail the build.

`contracts export` / `contracts diff` are the stored-artifact form of the same idea — see [migrate.md](migrate.md).

## Deploy-safety policy

Two config fields decide whether safety findings block a deploy. Both default to `report_only`.

| Field | Governs | Values |
| --- | --- | --- |
| `workflow.rls_safety` | RLS and grant rule-pack diagnostics, **except** `SUPA_RULE_SECDEF_SEARCH_PATH` | `disabled`, `report_only`, `deploy_blocking` |
| `workflow.type_safety` | type-contract diagnostics | `disabled`, `report_only`, `deploy_blocking` |

The deploy-safety RLS pack explicitly filters out the `SECURITY DEFINER` search-path rule, so `SUPA_RULE_SECDEF_SEARCH_PATH` stays advisory even at `deploy_blocking`. Treat it as a review finding you must act on yourself, not one the gate will stop.

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
