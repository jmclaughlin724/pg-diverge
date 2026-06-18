---
name: python
description: Applies current Python engineering best practices across project setup, runtime apps and CLIs, reproducible environments, API design, code quality, typing, testing, documentation, packaging, release management, supply-chain security, performance, observability, and library review. Use when working on Python code, Python packages, pyproject.toml, CLI entry points, argparse/Typer, asyncio/concurrency, logging/OpenTelemetry/debugging, uv/venv/tox/pre-commit, pytest, ruff, mypy, Sphinx, PyPI publishing, attestations, dependency security, profiling, or Python library health audits.
---

<objective>
Guide Python engineering work from design through release using upstream-verified practices and the bundled reference set derived from `wdm0006/python-skills`.
</objective>

<quick_start> First identify the user's intent, then read the matching workflow:

- New or modernized package: `workflows/setup-project.md`
- Runtime app, CLI, async/concurrency, logging, observability, debugging, or validation boundaries: `references/python-runtime-patterns.md`
- Reproducible environments, dependency groups, uv/venv, tox/pre-commit, supply-chain provenance, or native wheels: `references/python-environments-supply-chain.md`
- API design, refactor, typing, lint, or quality: `workflows/improve-code.md`
- Tests, fixtures, coverage, or property testing: `workflows/testing.md`
- Documentation or community files: `workflows/docs-community.md`
- Packaging, PyPI, changelog, or release: `workflows/package-release.md`
- Security, performance, dependency, or full library review: `workflows/audit-review.md`

Always respect the repository's existing toolchain first. If the repo already governs Python through uv, ruff, mypy/pyright, pytest, tox/nox, or custom wrappers, use those wrappers instead of replacing them with generic commands. </quick_start>

<essential_principles>

- Verify current upstream docs before changing tool configuration, publishing workflows, security policy, or dependency constraints. The source index lists official docs to check.
- Prefer `pyproject.toml` as the canonical project/tooling surface when the repo supports it.
- Prefer `src/` layout for distributable libraries unless the existing repo has a deliberate alternative.
- Treat public APIs as external contracts: preserve compatibility only where that contract exists, document deprecations, and test behavior before changing signatures.
- Make quality gates executable: lint, format, type check, test, package build, docs build, security scan, and benchmark only where relevant to the change.
- Do not add heavyweight tooling unless it solves a demonstrated problem in the repo. </essential_principles>

<routing>
Use this mapping without asking if the user's request is clear:

| User intent | Workflow |
| --- | --- |
| create project, modernize setup, pyproject, CI, pre-commit | `workflows/setup-project.md` |
| CLI/app entry points, argparse/Typer, asyncio, thread/process pools, logging, OpenTelemetry, pdb, faulthandler, tracemalloc, Pydantic boundaries | `references/python-runtime-patterns.md` |
| venv, uv lock/sync, dependency groups, tox/nox, pre-commit, PyPI trusted publishing, attestations, native extension or binary wheels | `references/python-environments-supply-chain.md` |
| API design, exceptions, deprecations, refactor, ruff, mypy, typing | `workflows/improve-code.md` |
| pytest, fixtures, parametrization, mocks, coverage, Hypothesis | `workflows/testing.md` |
| docstrings, Sphinx, README, tutorials, issue/PR templates, contributing | `workflows/docs-community.md` |
| build wheels/sdists, publish to PyPI, trusted publishing, changelog, SemVer | `workflows/package-release.md` |
| security audit, dependency audit, performance profiling, benchmark, library review | `workflows/audit-review.md` |

If multiple workflows apply, run them in lifecycle order: setup -> environments-supply-chain -> improve-code -> runtime-apps -> testing -> docs-community -> audit-review -> package-release. </routing>

<reference_index> Read these only when needed:

- `references/source-index.md`: requested GitHub source skills, attribution, and official upstream verification sources.
- `references/python-standards.md`: concise cross-domain standards and decision rules.
- `references/python-runtime-patterns.md`: CLI entry points, async/concurrency, logging, observability, debugging, memory/fault diagnostics, and Pydantic-at-boundaries guidance.
- `references/python-environments-supply-chain.md`: dependency groups, virtual environments, uv, tox/pre-commit, lockfiles, trusted publishing, attestations, native extensions, and binary distribution guidance.
- `references/tooling-templates.md`: reusable pyproject, lint/type/test/docs/security/release snippets.
- `references/review-checklists.md`: library review, security audit, performance review, and release readiness checklists.

For specialized web, data, or ML work, use official framework docs from `references/source-index.md` as optional pointers only unless the user asks for a framework-specific implementation plan. </reference_index>

<validation>
After any Python change, run the narrowest repo-owned checks that prove the change:

- Formatting/linting: repo wrapper, then `ruff check` / `ruff format` only if no wrapper exists.
- Typing: repo wrapper, then `mypy`, `pyright`, or project-selected type checker.
- Tests: focused pytest first, then broader suite when shared behavior changed.
- Packaging: `python -m build` and artifact validation when distribution metadata changed.
- Security: `pip-audit`, Bandit, Semgrep, or repo-approved scanners when dependencies or risky code changed.
- Docs: docs build or link/check command when documentation changed. </validation>

<success_criteria> Python work is complete when the relevant workflow was followed, upstream-sensitive claims were checked against official docs, repo-owned tooling conventions were preserved, and the narrowest meaningful verification passed or the remaining blocker is reported. </success_criteria>
