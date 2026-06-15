<required_reading> Read:

1. `references/source-index.md`
2. `references/python-standards.md`
3. `references/tooling-templates.md` </required_reading>

<process>
1. Inspect existing project shape before proposing changes: package manager, `pyproject.toml`, `setup.cfg`, `setup.py`, `tox.ini`, `noxfile.py`, `requirements*.txt`, `uv.lock`, CI, and Makefile/task wrappers.
2. For new distributable libraries, prefer `src/<package>/`, `tests/`, `pyproject.toml`, `README.md`, `LICENSE`, and `src/<package>/py.typed` when the package exports typed public APIs.
3. Use the existing build backend when present. For new projects, choose a backend deliberately: setuptools for broad compatibility, hatchling/flit for smaller pure-Python packages when the repo already prefers them.
4. Put project metadata and tool config in `pyproject.toml` when supported. Use modern license metadata: SPDX expression such as `license = "MIT"` and `license-files = ["LICENSE*"]`.
5. Configure quality gates around the repo's actual tools: ruff, type checker, pytest, coverage, docs build, and security scanners.
6. Add CI only where it fits the repo's platform. Test supported Python versions with a matrix, cache dependencies through official setup actions, and avoid shelling untrusted GitHub context into inline scripts.
7. Verify by running the repo's setup/static/test commands, or the template commands in `tooling-templates.md` for a new standalone project.
</process>

<success_criteria>

- Project metadata is centralized and valid.
- Imports test the installed package rather than accidentally importing the checkout root.
- Tooling commands are reproducible locally and in CI.
- CI uses current upstream setup actions and does not hardcode stale Python versions without reason. </success_criteria>
