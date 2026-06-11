# Security Policy

## Supported versions

Only the latest published release receives security fixes.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository (Security → Advisories → Report a vulnerability). Do not open public issues for exploitable problems. Reports are acknowledged within seven days.

## Design notes for reviewers

- Diff generation never connects to a database; `database:` sources and `verify` use the URL the caller supplies and run read-only `pg_catalog` queries plus temporary-database DDL.
- Database URLs and common credential shapes (URL passwords, JWTs, `*_key`/`token`/`secret` pairs) are redacted from diagnostic output.
- External validators run via `execFile` (no shell), with bounded output and a timeout.
- Generated SQL never includes `CASCADE`, and destructive operations require explicit configuration.
