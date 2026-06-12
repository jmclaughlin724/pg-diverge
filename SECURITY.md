# Security Policy

## Supported versions

Only the latest published release receives security fixes.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub security advisories: <https://github.com/jmclaughlin724/pg-diverge/security/advisories/new>. Do not open public issues, discussions, or pull requests for exploitable problems.

Include what you can of: the affected version, a reproduction (SQL input, command, config), the impact you believe it has, and any suggested fix. Coordinated disclosure is preferred; please give us the chance to ship a fix before publishing details.

## Disclosure process and timeline

- **Acknowledgement** within 7 days of the report.
- **Triage and severity assessment** within 14 days, communicated back on the advisory thread.
- **Fix or mitigation** targeted within 90 days of acknowledgement for confirmed vulnerabilities; faster for credential-exposure or SQL-injection-class issues.
- A fixed release is published to npm (<https://www.npmjs.com/package/pg-diverge>) with provenance, the advisory is published with credit to the reporter (unless anonymity is requested), and affected versions are documented in the advisory.

## Scope

In scope: the `pg-diverge` npm package — CLI, library API, install scaffold, and the composite GitHub action in this repository. Out of scope: vulnerabilities in PostgreSQL, Supabase, or third-party dependencies (report those upstream; we will still ship dependency bumps), and issues requiring a compromised local machine.

## Design notes for reviewers

- Diff generation never connects to a database; `database:` sources and `verify` use the URL the caller supplies and run read-only `pg_catalog` queries plus temporary-database DDL.
- Database URLs and common credential shapes (URL passwords, JWTs, `*_key`/`token`/`secret` pairs) are redacted from diagnostic output.
- External validators run via `execFile` (no shell), with bounded output and a timeout.
- Generated SQL never includes `CASCADE`, and destructive operations require explicit configuration.
