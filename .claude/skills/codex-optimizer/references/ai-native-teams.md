# AI-Native Teams Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/codex/guides/build-ai-native-engineering-team

## Intent

Use Codex to increase engineering throughput while keeping humans accountable for product judgment, architecture, safety, and final integration. Assign agents work that can be scoped, inspected, and validated.

## Delegation Rules

- Delegate code-aware exploration, draft plans, first implementations, tests, reviews, docs drafts, and triage.
- Keep humans responsible for priorities, irreversible architecture, final code quality, external commitments, safety-critical wording, and critical operations.
- Give agents explicit acceptance criteria and a reporting format.
- Require evidence for findings and verification for edits.

## Phase Patterns

| Phase   | Agent Handles                    | Human Owns            |
| ------- | -------------------------------- | --------------------- |
| Plan    | Code map, options, risks         | Scope and priority    |
| Design  | API sketches, migration options  | Architecture decision |
| Build   | First patch, mechanical refactor | Quality and tradeoffs |
| Test    | Coverage drafts, repros          | Acceptance standard   |
| Review  | Bug scan, CI analysis            | Merge decision        |
| Docs    | Draft and consistency pass       | External commitments  |
| Operate | Log triage, incident summary     | Critical response     |

## Team Implementation

1. Define the work type and risk level.
2. Choose whether Codex should delegate, review, or own a draft.
3. Attach validation to the assignment.
4. Review the result against the original acceptance criteria.
5. Promote only durable lessons into rules, skills, or owner briefs.

## Anilize Delivery Pattern

- Use subagents for bounded slices.
- Keep the main thread responsible for integration and final response.
- Do not let parallel agents mutate shared files without a clear merge owner.
