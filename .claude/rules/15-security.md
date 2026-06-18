---
enforcement:
  type: judgment-only
description: Security baseline for secrets, connection strings, diagnostics, shell safety, external fetches, webhooks, and package/docs examples.
paths:
  - "src/**"
  - "bin/**"
  - "scripts/**"
  - "services/agent-mcp/**"
  - "docs/**"
  - "tests/**"
  - ".github/workflows/**"
  - ".claude/**"
  - ".codex/**"
---

# Rule 15 — Security

## Contract

This rule owns the repo-wide security baseline: no secrets in source, commands, logs, examples, package artifacts, MCP output, generated diagnostics, or docs; external calls and shell execution must fail closed and redact sensitive values. Rule 20 owns the consolidated anti-pattern index for security violations.

## Rules

- Never hardcode API keys, JWTs, database URLs with passwords, access tokens, private keys, session cookies, or provider credentials.
- Do not read `.env*`, key files, certificate files, or secret directories just to inspect configuration. Use schema names, env variable names, and secure runtime access instead.
- Diagnostic output must redact URL passwords, JWTs, tokens, keys, and secret-shaped values before printing.
- Secret-detector tests use fragmented synthetic values, not complete fake credentials.
- Do not put secrets in argv. Use stdin, files with safe permissions, or existing secure env access when a command genuinely requires a secret.
- Do not interpolate user-controlled input into shell commands. Use argv arrays, allowlists, and path normalization.
- External `fetch`/HTTP responses check status before parsing body. Do not call `.json()`/`.text()` first and then decide whether the response was acceptable.
- Webhooks verify signatures over raw bodies before parsing. Enforce replay/idempotency when the provider supports it.
- MCP and agent surfaces are read-only unless the owner rule explicitly grants write authority. FastMCP must not expose shell execution, arbitrary file reads, credential reads, database mutation, or external LLM proxying.
- Docs and examples never include real credentials. Use placeholders such as `<DATABASE_URL>`, `<SUPABASE_ACCESS_TOKEN>`, or `<REDACTED>`.
- Package tarballs must not include repo-local secrets, caches, `.env*`, private keys, or maintainer-only context infrastructure.

## Security change matrix

| Change type | Required proof |
| --- | --- |
| Env/secret handling | redaction path, no secret-bearing argv/logs, package boundary clean |
| External fetch/client | non-2xx test or code path before body parse |
| Webhook/Auth Hook | raw-body signature verification before parse, replay/idempotency behavior |
| MCP/FastMCP | deny-list coverage, read-only proof, no secret paths |
| Package/docs example | no real credentials, dry-run tarball/docs check where applicable |
| CI/release | OIDC/provenance/token posture per Rule 09 |

## Verification

Run the narrow owner checks plus the security-relevant guard:

```bash
npm run guard
npm run check:package
```

For FastMCP changes, add `npm run guard:fastmcp` and Python checks. For docs examples, add `npm run docs:check`. For security anti-pattern changes, update Rule 20 in the same change.

## Failure behavior

Treat a secret-shaped hook or guard finding as a containment signal until triaged. Confirm whether a real credential leaked before rotating. Fix the source and redact output; do not weaken secret scanners, package allowlists, or MCP deny-lists to pass.

## Done means

- No secrets or credential-shaped values appear in committed source, commands, docs examples, package output, or diagnostics.
- External calls fail closed and parse only after status validation.
- Webhook/MCP/package surfaces maintain their security boundaries.
- Relevant guards/tests ran after the final security-affecting edit.
