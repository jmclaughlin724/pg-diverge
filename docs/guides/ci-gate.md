---
title: "CI gate"
description: "The drift, replay-safety, and policy-isolation CI gate: the free layer that exists today and the paid layer it is designed to become."
---

supaschema already ships the pieces of a CI gate. This document describes the free layer that exists today and the paid layer it is designed to become.

## Free: the GitHub Action and reporters

The committed composite action runs supaschema against a declarative tree on every push or PR:

```yaml
- uses: jmclaughlin724/supaschema@<tag>
  with:
    args: diff --from database:$DATABASE_URL --to dir:database/schemas --fail-on-diff --quiet
```

Three gates compose from existing commands, no service required:

- **Drift** — `diff --fail-on-diff` exits 3 when the declarative tree and the database disagree, failing the build on un-migrated schema.
- **Replay-safety** — `check --reporter github` annotates the PR diff, or `check --reporter sarif` uploads to the GitHub **code-scanning / Security** tab, flagging unguarded DDL, `CASCADE`, session `search_path`, and lock hazards.
- **Policy isolation** — because the diff plan classifies an RLS policy-body change as its own operation, a tightened `USING` predicate surfaces as a reviewable change instead of being dropped. This is the differentiator: the engines a team would otherwise rely on miss it.

This layer is AGPL and free. It is the funnel.

## Paid: the hosted policy-isolation gate

The free Action runs in the customer's CI and reports per-run. The paid layer is a hosted GitHub App that turns the same engine into an org-level security control:

- **PR + Security-tab surface** — SARIF findings posted to every PR and aggregated in the org's code-scanning dashboard, with a dedicated **tenant-isolation policy change** finding class (a policy `USING`/`WITH CHECK` predicate changed, was removed, or weakened) that requires explicit review acknowledgement before merge.
- **History and drift over time** — per-repo migration lineage, drift trend, and a record of every policy change shipped, so an isolation regression has an audit trail.
- **Org policy** — required-check enforcement, allowed-hint review (no `hints.destructive: "*"` reaching `main`), and per-environment gates (`staging`/`production`) wired to named `environments`.
- **No-CI-config onboarding** — install the App, point it at the configured schema tree (`database/schemas`, `supabase/schemas`, `neon/schemas`, `aws-postgresql/schemas`, `cloud-sql/schemas`, `alloydb/schemas`, `azure-postgresql/schemas`, or another configured path), done; no workflow YAML, no `DATABASE_URL` plumbing in the customer's Actions.

The engine is unchanged; the paid surface is hosting, the Security-tab integration, the policy-change finding class, and org administration. That is a per-repo or per-seat SaaS, not a CLI license — far higher ARPU, and the security framing (a tenant-isolation gate) carries the willingness to pay.

## Sequencing

1. Publish the package so the Action resolves (`npx supaschema@<tag>`).
2. Ship the free Action + SARIF reporter as the funnel; instrument adoption.
3. Build the hosted App once there is adoption signal and at least one reference customer (the case study is the first).

## Open pricing decisions (founder)

- Per-repo vs per-seat vs per-org-tier.
- Whether the tenant-isolation finding class is the free hook or a paid-only gate.
- Self-serve vs sales-assisted for the commercial license (see `LICENSE-COMMERCIAL.md`).
