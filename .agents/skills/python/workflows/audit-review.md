<required_reading> Read:

1. `references/source-index.md`
2. `references/python-standards.md`
3. `references/review-checklists.md` </required_reading>

<process>
1. For a full library review, inspect structure, packaging metadata, public API, dependencies, tests, docs, CI, release history, security posture, and performance-sensitive paths.
2. For security review, map trust boundaries first: user input, filesystem paths, subprocesses, SQL/database calls, network calls, deserialization, templates, secrets, credentials, and dependency resolution.
3. Use scanners as evidence, not as a substitute for review: Bandit for common Python code issues, pip-audit for vulnerable dependencies, Semgrep for custom/static patterns, detect-secrets for credential leaks.
4. For performance work, profile before optimizing. Use `cProfile` or PyInstrument for CPU paths, `tracemalloc` or Memray for memory paths, and pytest-benchmark/timeit for repeatable comparisons.
5. Report findings by severity and evidence. Include exact file/line references when reviewing local code.
6. Fix the root cause to the smallest correct end state unless an external contract requires compatibility staging.
7. Verify with the matching test/security/performance command and record before/after evidence for performance claims.
</process>

<success_criteria>

- Findings distinguish confirmed issues from risks and assumptions.
- Security fixes address the trust boundary, not only the scanner warning.
- Performance changes are backed by measured before/after evidence.
- Library review includes prioritized next actions rather than a generic scorecard only. </success_criteria>
