<python_environments_supply_chain> Use this reference for Python environment reproducibility, dependency automation, multi-environment checks, publishing security, and binary/native packaging decisions.

<dependency_surfaces>

- Respect the repo's existing dependency manager first. Do not replace uv, Poetry, Hatch, pip-tools, tox, nox, or custom wrappers just because another tool is generally preferred.
- Keep published runtime dependencies in `[project.dependencies]` and extras in `[project.optional-dependencies]`.
- Use `[dependency-groups]` for local development groups such as `test`, `docs`, `lint`, `dev`, and `typing` when the repo's tooling supports the PyPA dependency-groups spec.
- Do not confuse dependency groups with extras: groups are not published package metadata and need tool-specific installation commands.
- Keep interpreter constraints (`requires-python`) aligned with CI, tox/nox, lockfiles, and supported-version docs. </dependency_surfaces>

<virtual_environments_and_locks>

- Use stdlib `venv` when no project manager exists; create isolated environments rather than installing into global Python.
- For uv projects, prefer `uv lock` and `uv sync` semantics over hand-edited requirements exports unless the repo already consumes exported requirements.
- Commit lockfiles when the project policy expects reproducible application or tool environments. For libraries, decide lockfile policy explicitly because consumers resolve dependencies independently.
- Keep lock refreshes separate from behavioral code changes when possible, and explain major resolver changes.
- Avoid broad dependency upper-bound churn unless upstream compatibility evidence or project policy supports it. </virtual_environments_and_locks>

<multi_environment_automation>

- Use tox or nox when the project needs repeatable checks across Python versions, dependency sets, optional extras, or packaging/install modes.
- Prefer repo-owned commands inside tox/nox environments so local and CI gates stay aligned.
- Use pre-commit for fast local hygiene only when hooks are stable, deterministic, and match the repo's actual lint/format/security commands.
- Keep pre-commit hooks pinned and update them intentionally. Do not let hooks silently define a different formatter, linter, or Python version than CI.
- For CI, cache package/tool downloads without caching mutable virtual environments in ways that hide dependency resolution failures. </multi_environment_automation>

<publishing_and_provenance>

- Prefer PyPI Trusted Publishing over long-lived API tokens for automated releases when the hosting CI supports it.
- Configure trusted publishers to the narrow repository, workflow, environment, and project needed for release. Treat changes as security-sensitive.
- Use PyPI attestations when release provenance matters. Verify that each uploaded artifact is covered and that downstream verification expectations are documented.
- Build artifacts in clean automation, then inspect names, metadata, included files, license files, importability, and provenance before publishing.
- Publish to TestPyPI only as a packaging smoke test; do not treat it as proof that production metadata, trusted publishing, or install indexes are fully correct. </publishing_and_provenance>

<advanced_packaging_and_native_extensions>

- Stay with pure-Python wheels unless native code solves a measured performance, platform, or integration problem.
- For C/C++ extension modules, use build-backend-supported extension configuration and verify headers, compiler flags, limited-API/ABI choices, and platform tags.
- For Rust extensions, use maturin when it fits the repo. Keep `pyproject.toml`, `Cargo.toml`, Python package layout, and wheel tags consistent.
- Build both sdist and wheels when publishing native packages. Test install from the produced artifacts, not only from the checkout.
- Verify platform compatibility with the relevant wheel tags and manylinux/musllinux/macOS/Windows expectations before upload.
- Ensure sdists include the files needed to rebuild native artifacts, and exclude generated build outputs that should not be source-controlled. </advanced_packaging_and_native_extensions>

<supply_chain_review_checklist>

- Verify official docs before changing publishing auth, dependency constraints, lock policy, binary build settings, or CI release permissions.
- Check dependency provenance for direct URL, VCS, path, alternate index, and editable dependencies. These are higher-review surfaces than ordinary registry dependencies.
- Review dependency confusion risk when private indexes, explicit indexes, or similarly named internal packages are involved.
- Keep secrets out of pyproject files, tox/nox config, pre-commit config, CI logs, build metadata, and package artifacts.
- Run the narrowest meaningful proof: dependency sync/lock check, tox/nox/pre-commit target, artifact build/install, or PyPI/TestPyPI dry run depending on the change. </supply_chain_review_checklist> </python_environments_supply_chain>
