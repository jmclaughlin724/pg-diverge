<required_reading> Read:

1. `references/python-standards.md`
2. `references/tooling-templates.md` </required_reading>

<process>
1. Decide documentation audience: importer/API user, CLI user, contributor, maintainer, or security reporter.
2. For public functions/classes, write docstrings that cover purpose, parameters, returns, raises, and one realistic example when it reduces ambiguity.
3. If using Sphinx, enable `autodoc` for API docs and `napoleon` when Google or NumPy docstrings are used. Guard import side effects before autodoc imports modules.
4. Keep README focused on install, quick start, links to docs, supported Python versions, and project status.
5. For community setup, add concise `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue templates, PR template, and security reporting path only when the project is meant to receive external contributions.
6. Keep docs synchronized with API changes and tests. Examples should either be executable or intentionally marked as illustrative.
7. Verify by building docs or running the repo's docs/check command when available.
</process>

<success_criteria>

- Public API docs match the implemented signatures and exceptions.
- New contributors can set up, test, and submit a change from the contribution docs.
- Docs build or the relevant docs validation passes. </success_criteria>
