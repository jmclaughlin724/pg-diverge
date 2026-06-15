<required_reading> Read:

1. `references/python-standards.md`
2. `references/tooling-templates.md` </required_reading>

<process>
1. Identify the public API before editing. Treat exported names, documented functions/classes, CLI commands, serialized fields, and exception types as compatibility surfaces.
2. Design APIs for simple common use and explicit advanced use. Prefer keyword-only options for optional behavior. Avoid boolean traps such as `process(data, True, False)`.
3. Use custom exceptions only when they improve caller handling. Derive user exceptions from `Exception`, keep a project base exception, and include actionable messages.
4. For deprecations, issue `DeprecationWarning` with `stacklevel=2`, document the replacement, test the warning, and remove only in the promised major/breaking release.
5. Run the repo linter/formatter. If configuring from scratch, use ruff for linting and formatting, with rule sets scaled to the project's maturity.
6. Add or tighten type hints where they clarify API contracts. Prefer `collections.abc` protocols and ABCs for input shapes; use `typing.Protocol` for structural contracts; avoid `Any` unless it describes genuinely dynamic data.
7. Refactor only after characterization tests or clear static evidence protect behavior.
</process>

<success_criteria>

- Public API behavior is preserved or the compatibility break is intentional, documented, versioned, and tested.
- Lint/format/type checks pass through repo-owned commands.
- Type changes make caller behavior clearer rather than hiding errors with broad casts or ignores. </success_criteria>
