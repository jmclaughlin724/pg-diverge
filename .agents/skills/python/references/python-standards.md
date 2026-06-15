<python_standards> <project_setup>

- Prefer `pyproject.toml` for build metadata and tool configuration.
- Prefer `src/` layout for distributable libraries; it catches accidental imports from the checkout root.
- Use `requires-python` for real interpreter compatibility. Trove classifiers are metadata/search hints, not install constraints.
- Use SPDX license expressions such as `license = "MIT"` and include license files.
- Add `py.typed` only when the package intentionally exports type information. </project_setup>

<api_design>

- Make simple use simple and advanced use explicit.
- Prefer descriptive names and keyword-only optional arguments.
- Avoid boolean traps; use enums, literals, strategy objects, or separate functions for materially different behavior.
- Expose a small public surface. Keep internals private and document public API contracts.
- Derive custom user exceptions from `Exception`, not `BaseException`; avoid multiple inheritance from exception classes.
- Use `DeprecationWarning` for developer-facing API deprecations, `stacklevel=2`, tests that assert warnings, and documentation with the replacement. </api_design>

<quality_and_typing>

- Use ruff for linting/formatting where the repo has not chosen another formatter.
- Use mypy or the repo-selected type checker for static contracts. Adopt strictness gradually in legacy code.
- Prefer `collections.abc` interfaces (`Sequence`, `Mapping`, `Iterable`, `Callable`) for inputs and concrete containers for return values where callers need them.
- Use `Protocol` for structural contracts, `TypedDict` for dict-shaped payloads, and `Literal`/Enum only when values are intentionally constrained.
- Avoid broad `Any`, blanket ignores, and casts that hide real shape problems. </quality_and_typing>

<testing>
- Use pytest for behavior tests, with fixtures scoped as narrowly as possible.
- Use parametrization for repeated behavior cases; add readable ids for complex cases.
- Use factory fixtures for repeated object creation with small variations.
- Use Hypothesis when invariants matter more than individual examples: round trips, parser/serializer behavior, numeric boundaries, sorting/order, idempotence, and input validation.
- Mock boundaries, not implementation details.
</testing>

<documentation_and_community>

- Keep README focused on install, quick start, docs links, supported Python versions, and status.
- Use Sphinx `autodoc` for API docs and `napoleon` when using Google or NumPy style docstrings.
- Guard import side effects before using autodoc because autodoc imports documented modules.
- Add community files only when useful: contributing guide, code of conduct, issue/PR templates, security reporting. </documentation_and_community>

<security>
- Validate untrusted input at boundaries.
- Use parameterized SQL; never format user input into queries.
- Avoid `shell=True`; pass subprocess arguments as a list and validate paths.
- Resolve paths and enforce base-directory containment for user-supplied filenames.
- Do not deserialize untrusted pickle/yaml-with-object data.
- Keep secrets out of source, logs, exceptions, docs, and tests.
- Scan dependencies separately from source code; dependency scanners do not prove application code is safe.
</security>

<performance>
- Profile before optimizing.
- Use `cProfile` for built-in deterministic profiling and PyInstrument for readable wall-clock traces.
- Use `tracemalloc` for Python allocation snapshots; use Memray when native allocation visibility is needed.
- Use repeatable benchmarks for regression protection. Keep benchmarks isolated from network and clock instability.
- Prefer algorithmic fixes and data-structure changes over micro-optimizations.
</performance>

<release>
- Version only after identifying the public API.
- Use SemVer when the project has a clear public API: patch for compatible fixes, minor for compatible features or deprecations, major for breaking API changes.
- Keep changelogs human-readable with Added, Changed, Deprecated, Removed, Fixed, Security.
- Prefer PyPI Trusted Publishing over long-lived API tokens.
</release>
</python_standards>
