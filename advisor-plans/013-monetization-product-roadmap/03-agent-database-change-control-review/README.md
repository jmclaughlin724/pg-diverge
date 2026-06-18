# Proposal 03: Agent Database Change-Control Review

Planned on 2026-06-16 against commit `fb8c461`.

> Executor instructions: Follow this plan step by step. This lane sells deterministic guardrail review for agent-edited database changes. Do not add hosted agent orchestration or production apply automation.

> Drift check: `git diff --stat fb8c461..HEAD -- AGENTS.md CLAUDE.md .codex/hooks.json .claude/settings.json .agents/prompts/supaschema-install.md .agents/skills/supaschema/SKILL.md .claude/skills/supaschema/SKILL.md skills/supaschema/SKILL.md bin/scaffold.mjs scripts/agent-hooks tests/agent-hooks.test.ts docs/coding-agents.mdx docs/coding-agents/agent-bundle.mdx advisor-plans/013-monetization-product-roadmap/03-agent-database-change-control-review`

> Before executing: read the **Executor Readiness Contract** in `../README.md`. The `supaschema agents doctor`, `agents doctor --fix-plan`, `agents apply-fix-plan`, and `agents evidence` commands DO NOT EXIST yet — they are TO CREATE. The first executable step is the Phase 0 design spec: new `src/cli-agents.ts` registered via `src/cli-tools.ts`; the control checklist + severity model (enumerate the controls, do not leave "define the score" open); the report JSON schema; exit codes; named to-create test files (e.g. `tests/agents-doctor.test.ts`). Convert every prose done criterion to a command + expected output. Do not weaken any hook or generated-migration guard.

## Status

- Priority: P1
- Effort: M
- Risk: MED
- Depends on: none
- Category: agent governance / monetization
- Execution lens: elegant canonical-owner execution.
- Protected invariant: keep the free local agent bundle intact and never let agents apply migrations outside configured automation and approval gates.

## Why This Matters

AI agents can edit schema SQL and migrations faster than humans can review them. Supaschema already has generated migration guards, local hooks, install prompts, and agent rules. That creates a sellable governance review without hosting customer code or databases.

## User Types And Value Proposition

| User type | Trigger | Value proposition |
| --- | --- | --- |
| AI tooling owner | Agents are changing database-backed apps | Turns prompt trust into deterministic database guardrails |
| Platform engineer | Needs consistent agent rules across repos | Verifies hooks, rules, and generated migration protections |
| Engineering manager | Wants more agent speed without migration incidents | Gives a readiness score and remediation list |
| Security reviewer | Needs proof agents cannot apply production migrations | Produces agent-control evidence without exposing secrets |

## Actionable Pain Points

- Agents edit generated migrations directly.
- Agent prompts do not encode schema safety rules.
- Apply or sync commands can be attempted without explicit human approval.
- Hooks differ across repos.
- No proof that generated migration protection is installed.
- Agent-authored schema PRs are hard to review.

## Market And Client Value

- Public TAM anchor: AI code tools, `$7.37B` in 2025 and `$29.96B` by 2031.
- Supaschema SAM estimate: `0.25%-1%` database-governance wedge around AI coding tools, or about `$18M-$74M` current annual spend.
- Client value:
  - `$5k-$20k` setup review.
  - `$15k-$75k/year` for ongoing governance pack across agent-enabled repos.
- First-24-month opportunity: `10-30` customers at `$10k-$50k` ACV produces `$100k-$1.5M`.

## Revenue Generation Model

- Start with a fixed setup/hardening review.
- Convert repeated findings into an agent readiness command and evidence output.
- Meter ongoing subscriptions by agent-enabled repo, protected project, active schema contributors, and support tier.
- Add hosted policy sync only after account and entitlement models exist.

## Current State Evidence

- `bin/scaffold.mjs` installs config, prompts, rules, hooks, and agent bundle surfaces.
- `.codex/hooks/auto-diff-on-schema-change.mjs` runs local diff/check after schema writes.
- `.codex/hooks/block-generated-migration-edits.mjs` blocks edits to generated migrations with lineage markers.
- `.codex/hooks.json` wires consumer hooks.
- `tests/agent-hooks.test.ts` covers hook behavior.
- `docs/coding-agents/agent-bundle.mdx` documents the consumer bundle.

## Upstream Verification Notes

- Secure software development guidance treats provenance and change evidence as control material. Agent governance reports must record the source files, commands, generated artifacts, and actor/tool identity used to produce the evidence.
- Hosted agent orchestration requires an approved authentication and token custody model before any customer repository or database access is offered.
- Agent transcripts can contain secrets and proprietary code. The default governance report must not collect transcripts; any future collection needs explicit retention, deletion, and customer-approval rules.
- Artifact or build provenance is only useful when the consumer can verify the signer, timestamp, and subject artifact. A local governance report should label unsigned evidence as local evidence, not attested provenance.

## Automation And Onboarding Needed

1. Agent readiness command:
   - verify Codex hook config.
   - verify Claude settings if present.
   - verify AGENTS/CLAUDE guidance.
   - verify generated migration guards.
   - verify auto-diff/check hooks.
   - verify sync/apply command restrictions.
2. Agent-risk score:
   - missing guard.
   - weak instruction.
   - direct generated migration edit path.
   - apply command exposure.
   - missing CI check.
3. Patch generator:
   - suggest exact rule or hook additions.
   - preserve user-owned instructions.
   - produce human-reviewable diffs.
4. Output:
   - agent governance report.
   - installed guard proof.
   - required remediation list.
   - evidence pack section for agent controls.

## Automation-First Workflow

This offer should become a repo-hardening scanner and patch generator. Manual review should happen after the command produces exact findings and patches.

1. `supaschema agents doctor` scans `AGENTS.md`, `CLAUDE.md`, `.codex`, `.claude`, generated migration guards, auto-diff/check hooks, CI workflows, and apply/sync exposure.
2. The command emits a structured governance report with pass/fail controls, severity, actor/tool provenance, and evidence file references.
3. `supaschema agents doctor --fix-plan` generates a patch plan instead of mutating files.
4. `supaschema agents apply-fix-plan` applies only approved local patches and refuses to overwrite unrelated user-owned instructions.
5. An agent-governance agent reads the report JSON and drafts PR descriptions, remediation issues, and executive summaries.
6. A GitHub Action runs the guard in CI and fails when required controls are missing.
7. `supaschema agents evidence` exports the installed guard proof for release evidence packs.
8. Human approval is required only for applying patches, changing policy posture, or enabling hosted policy sync.

First automation deliverable:

- `supaschema agents doctor` plus JSON/Markdown report output.

Full automation deliverable:

- readiness scanner, fix-plan generator, safe patch applier, CI gate, governance-agent summaries, multi-repo rollup, and evidence export.

## Implementation Waves

### Wave 1: Manual Governance Review

Create review templates and secret-safe intake:

- agent rule inventory.
- hook inventory.
- generated migration guard proof.
- sync/apply control checklist.

Verification:

- docs checks exit 0 if public docs change.
- no consumer package contents change unless package tests pass.

### Wave 2: Readiness Detector

Add an agent readiness report that inspects local files and reports missing guardrails.

Verification:

- `npm test -- tests/agent-hooks.test.ts` exits 0.
- detector tests cover missing hook, missing rule, and guarded migration cases.
- report output redacts secrets.

### Wave 3: Governance Subscription Shape

Productize repeated findings:

- org policy template.
- agent evidence output.
- remediation task export.
- recurring review checklist.

Verification:

- package boundary docs and tests pass if bundle contents change.
- no maintainer-only tooling ships to consumers.

## Scope

In scope:

- agent setup review.
- hook/rule detector.
- generated migration guard proof.
- remediation report.
- agent governance evidence.

Out of scope:

- hosted agent orchestration.
- production migration apply.
- background agent control plane.
- private paid hooks in the public consumer bundle.
- FastMCP as a consumer dependency.

## Full Rollout Gap Analysis

### Product Gaps

- Agent readiness command is not built. Full rollout needs a deterministic command that inspects hooks, rules, prompts, generated migration guards, CI checks, and sync/apply posture.
- Agent-risk scoring is not defined. Full rollout needs severity levels, scoring weights, and clear remediation for each failed control.
- Patch generation is not designed. Full rollout needs safe patch suggestions that preserve user-owned instructions and never overwrite unrelated agent rules.
- Cross-agent coverage is incomplete. Full rollout needs documented handling for Codex, Claude Code, and generic AGENTS guidance, with clear behavior when a repo only uses one agent.
- Evidence output is missing. Full rollout needs a report that proves generated migration guards, auto-diff/check hooks, and explicit apply posture are in place.
- Actor and tool provenance is missing. Full rollout needs evidence fields for agent type, hook source, command source, changed files, generated artifacts, and whether evidence is signed, unsigned, or externally attested.

### Automation And Onboarding Gaps

- Agent governance fit quiz is not built.
- Guard verifier is not built.
- Sync/apply exposure detector is not built.
- Generated migration guard proof is not included in an evidence bundle.
- Suggested-patch flow is not built.
- Multi-repo rollup is not available for teams with many agent-enabled repos.
- Transcript handling is not defined and must default to no transcript collection.
- No agent workflow exists for converting governance report JSON into PR text, remediation issues, or executive summaries.

### Commercial And Operational Gaps

- Review scope is not defined. Full rollout needs a boundary between setup review, remediation help, ongoing governance, and incident response.
- Support process for customer-specific agent rules is missing.
- Paid governance pack does not have packaging, renewal, or entitlement rules.
- There is no policy for private customer repositories, screenshots, or agent transcript handling.
- Auth, token custody, retention, deletion, and customer approval are missing for any hosted agent orchestration or policy sync.
- Enterprise buyers may require security posture for any uploaded evidence; this must remain local until custody is approved.

### Implementation Steps To Full Rollout

1. Define the agent control checklist and severity model.
2. Implement local readiness detection for Codex hooks, Claude settings, AGENTS/CLAUDE guidance, generated migration guards, auto-diff/check hooks, sync/apply restrictions, and CI checks.
3. Add report output with installed controls, failed controls, remediation, and evidence references.
4. Add actor/tool provenance fields and default transcript exclusion.
5. Add `--fix-plan`, approved patch application, and governance-agent prompt templates.
6. Add tests for missing hook, missing generated migration guard, unsafe apply exposure, missing CI check, and mixed-agent repo states.
7. Add suggested-patch generation with strict preservation of existing user instructions.
8. Add service report template and secret-safe intake.
9. Add multi-repo rollup only after single-repo detector is stable.
10. Add hosted policy sync only after auth, entitlement, and customer-data custody are approved.

### Full-Rollout Exit Criteria

- A repo can produce a local agent governance report without uploading code.
- The report proves generated migrations are protected.
- The report proves auto-diff/check hooks are installed when expected.
- The report proves sync/apply remains explicit.
- The report records actor/tool provenance without collecting transcripts by default.
- Missing guardrails can produce an approved patch plan automatically.
- Suggested patches are narrow, reviewable, and do not overwrite user-owned instructions.

## Done Criteria

- A repo can prove generated migration guards are installed.
- A repo can prove schema writes trigger local diff/check behavior.
- A repo can prove apply/sync remains explicit.
- A reviewer gets a concrete remediation list.

## Stop Conditions

Stop if:

- the plan requires weakening hooks or generated migration protection.
- the plan requires agents to apply migrations automatically.
- the plan exposes service-role access to client or agent code.
- the plan requires private maintainer tooling in the public package.

## Maintenance Notes

This offer is a governance lane, not an agent product. Keep it grounded in local deterministic proof.
