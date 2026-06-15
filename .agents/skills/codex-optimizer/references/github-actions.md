# GitHub Actions Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/codex/github-action

## Intent

Use the Codex GitHub Action for bounded repository automation in CI: issue triage, PR assistance, generated patches, structured analysis, or scheduled maintenance. Do not use it as a substitute for deterministic CI checks.

## Workflow Design

1. Pick a trusted trigger. Avoid exposing powerful prompts to untrusted issue, comment, or fork content without sanitization.
2. Run deterministic setup and cheap checks before Codex.
3. Give Codex a narrow prompt with files, constraints, and expected output.
4. Use `codex-args` for sandbox, model, effort, output schema, and other CLI controls.
5. Capture `final-message` or `output-file` as the workflow artifact.

## Inputs To Set Deliberately

- `openai-api-key`: store as a protected secret.
- `prompt` or `prompt-file`: prefer checked-in prompt files for repeatable workflows.
- `model` and `effort`: match task difficulty.
- `sandbox`: keep the default constrained posture unless the job requires more.
- `codex-version`: pin when reproducibility matters.
- `codex-home`: isolate state when workflows should not share config.

## Security Rules

- Protect the API key from prompt injection and log exposure.
- Sanitize issue, PR, and comment text before embedding it in prompts.
- Use allowed users or bots for interactive triggers.
- Rotate credentials if exposure is suspected.
- Treat read-only repo permission as useful but insufficient by itself.

## supaschema Delivery Pattern

- If adding a workflow, update the owning `.github/workflows/**` file and any repo rule that defines CI expectations.
- Do not move local sync or hook responsibilities into GitHub Actions unless the repo ownership model changes.
