---
name: supaschema
description: Use when working on PostgreSQL or Supabase schema changes in a supaschema project - covers onboarding and adoption, declarative schema edits, generated migrations, drift detection, migration-history reconciliation, replay-safety checks, RLS and grant safety scans, type-contract regression gates, generated TypeScript/Zod contracts, CI gating, and SUPA_* diagnostics.
license: MIT
metadata:
  compliance: agent-skills-v1
  public: true
  keywords:
    - supaschema
    - schema migration
    - database migration
    - declarative SQL
    - migration drift
    - migration history
    - replay safety
    - generated contracts
    - RLS policy safety
    - grant exposure
    - schema safety scan
    - type contract regression
    - SUPA diagnostic
---

# supaschema

## Contract

Express schema intent in the configured declarative tree; let supaschema generate the migration, the replay proof, and the typed contracts. This skill owns tool semantics and workflow shape. Migration policy, ordering, ownership, and stop conditions live in the bundled supaschema rule — read it when the project ships one.

Three rules hold in every lane:

- **Never hand-edit a generated artifact.** Generated migrations, generated TypeScript, and generated Zod output are outputs. Fix the canonical source and regenerate.
- **Never bypass a `SUPA_*` diagnostic.** Every code names the canonical file, config field, hint, or artifact that must change. Resolve it there.
- **Never invent facts the corpus does not contain.** Row values, Vault secret material, tenant predicates, conversion expressions, and workload indexes come from reviewed sources or from a diagnostic that demands them.

## Orient First

Run these before the first schema edit; they are credential-free and cheap.

```bash
supaschema doctor           # Node, parser, config, URL resolution, DB reachability, history, tree
supaschema onboard          # readiness + incumbent migration system
supaschema config validate  # config resolution as the CLI sees it
supaschema migrations       # on-disk migrations vs. applied history
```

`doctor` is the first command to reach for when anything looks misconfigured — it reports every resolution step at once instead of failing one command at a time.

Exit codes share one vocabulary:

| Exit | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | success                                                    |
| `1`  | runtime error — bad arguments, unreadable input, crash     |
| `2`  | diagnostics contained at least one error                   |
| `3`  | `--fail-on-diff` was set and the plan contained operations |

Report-only lanes are the exception: `type-contract` without `--enforce` and `onboard` both render error-severity diagnostics and still exit 0. In CI, use `type-contract --enforce` when a breaking contract must fail the build, and read the report rather than the exit code for `onboard`.

Then read `supaschema.config.json` and treat four fields as the source of truth:

| Field | Owns |
| --- | --- |
| `schemaPaths` | the declarative end-state; the only tree you edit |
| `sources.from` | the before-state baseline for every diff |
| `migrationsDir` | history **and** operational source intent **and** lineage baseline proof |
| `workflow.*` / `sync.targets` | generation, typing, and apply policy |

If `.supaschema/install.json` exists with `"pathConfirmationNeeded": true`, that is an agent handoff: read `agentInstructions`, choose from the candidate `schemaPaths` and `migrationsDirs`, and write explicit values into `supaschema.config.json` before running any workflow command. Normal resolved installs do not create `.supaschema/`. Never generate a migration from a guessed path — the bundled hooks also skip auto-diff until both fields are explicit.

Full setup, install, and config-field detail: [references/setup.md](references/setup.md).

## Pick The Lane

| Situation | Lane | Reference |
| --- | --- | --- |
| New schema change, or adopting an existing project | Migrate | [references/migrate.md](references/migrate.md) |
| CI drift failure, stale generated output, history anomaly, routine maintenance PR | Maintain | [references/maintain.md](references/maintain.md) |
| RLS/grant review, lock risk, contract regressions, wiring a CI gate | Harden | [references/safety.md](references/safety.md) |
| A command exited 2 or 3 and named a code | Diagnose | [references/diagnostics.md](references/diagnostics.md) |

The two workflow lanes run the same core sequence, differing in what starts them and what the reviewable unit contains. The Harden lane runs alongside either one — it proves a change is safe to ship, not merely that it replays.

## Core Sequence

1. **Edit the declarative tree** (`schemaPaths`) to express the desired end state, using schema-qualified names. Typical roots are `database/schemas/**`, `supabase/schemas/**`, or a detected managed-provider root such as `neon/schemas/**`.
2. **Read the existing migration corpus before generating.** It is not only history — it carries row backfills, explicit DML/`DO` workflows, enum rewrite recipes, Vault references, workload-proven index intent, reviewed routine drops, and provider bootstrap constraints. When a change depends on data movement, secret placeholders, or workload-derived indexes, confirm the intent already exists there, in config, in a hint, or in a workload artifact.
3. **Generate:** `supaschema diff` → `<UTC timestamp>_<name>.sql` in `migrationsDir`. The write is no-clobber and chain-gated.
4. **Prove replay safety:** `supaschema check` must exit 0 — for generated and hand-authored migrations alike.
5. **Refresh contracts:** `supaschema types` regenerates TypeScript and Zod from the configured schema source, including views, materialized views, view-on-view dependencies, functions, enums, and composites. Never wait for a deploy or run introspection-based typegen to get correct types. Generated contracts open with a provenance header (generator version, model fingerprint); `supaschema types --check` is the no-write CI gate that fails on drift (`SUPA_TYPES_CONTRACT_DRIFT`).
6. **Review as one unit:** schema edit + generated migration + generated contracts + command evidence.
7. **Apply only on explicit request,** and only when config, target resolution, safety gates, and required runtime approval all allow it.

`supaschema sync` composes steps 3–5 plus target selection, history reconciliation, closure staging, deploy-safety gates, runner apply, and final reconciliation. Use it as the one-command lane; use `diff`, `check`, `types`, `stage`, and `apply` when the user asks for a focused step.

## Before You Say It Cannot Be Modeled

Inspect all three configured sources first — `schemaPaths` for the end-state, `sources.from` for the baseline, `migrationsDir` for source intent and lineage proof. Then:

- **Check the support matrix.** `docs/reference/support-matrix.mdx` is the authoritative per-object answer, and `supaschema audit --from <source>` reports coverage against it. The executable contract is `src/sql/support.ts`.
- Decode the code: `supaschema explain <SUPA_CODE>` works offline.
- Triage scale: `supaschema diff --summary`, `supaschema selfcheck`.
- If the runtime lane genuinely cannot model the case, write a reviewed explicit migration and validate it with `check` and `verify`. Do not patch application code with casts, aliases, or local contract copies to hide missing model coverage — `supaschema scan --contract-usage <dir>` detects exactly that.

Unsupported or ambiguous DDL fails closed by design. Treat SQL semantics as an AST/model problem — parse trees and structured model helpers, never regular expressions, decide whether SQL is safe, equivalent, destructive, or replayable.

## Reference Index

Load only the reference the current lane needs.

| Reference | Load when |
| --- | --- |
| [references/setup.md](references/setup.md) | installing, running `init`, resolving an install handoff, or reading a config field |
| [references/migrate.md](references/migrate.md) | creating a schema change or adopting an existing migration system |
| [references/maintain.md](references/maintain.md) | detecting drift, reconciling history, or preparing a maintenance change |
| [references/safety.md](references/safety.md) | scanning RLS/grants/hygiene, gating contract regressions, or wiring CI |
| [references/diagnostics.md](references/diagnostics.md) | a `SUPA_*` code is blocking, or you need source/apply boundaries |
