<review_checklists> <library_health> Review:

- Structure: `src/` layout or deliberate alternative, package imports, `py.typed` when typed.
- Metadata: valid `pyproject.toml`, Python version bounds, license, URLs, package data.
- API: small public surface, consistent names, clear errors, documented deprecations.
- Code quality: lint, format, type checks, no broad ignores hiding real issues.
- Tests: core behavior, errors, boundaries, property tests where useful, coverage on critical paths.
- Docs: README, API docs, changelog, examples matching current API.
- CI: matrix for supported Python versions, dependency caching, test/lint/type/security gates.
- Security: secrets, injection, path traversal, subprocess, deserialization, dependencies.
- Release: changelog, SemVer alignment, artifact build, trusted publishing. </library_health>

<security_review> Check:

- SQL/database calls use parameters.
- Subprocess calls avoid shells and validate arguments.
- User-supplied paths are normalized with `Path.resolve()` and checked against an allowed base.
- YAML, pickle, marshal, and dynamic imports are not used on untrusted input.
- Secrets are loaded from secure runtime configuration and never logged.
- Dependency scanning is current and lockfiles are intentional.
- CI does not interpolate untrusted GitHub context into shell scripts. </security_review>

<performance_review> Check:

- The bottleneck is measured before optimization.
- Benchmark input reflects real workload shape.
- CPU profiling and memory profiling are separated.
- Optimizations preserve behavior with tests.
- Changes reduce algorithmic complexity or allocation pressure before adding cache/global state.
- Benchmarks include before/after evidence and an acceptable variance threshold. </performance_review>

<release_readiness> Check:

- Public API changes match version bump.
- Changelog has user-facing entries.
- Tests, lint, typing, docs, security scans, and build pass as applicable.
- Wheel and sdist contain expected files and exclude local artifacts.
- Clean install from built wheel succeeds.
- Publishing uses trusted publisher or tightly scoped token. </release_readiness> </review_checklists>
