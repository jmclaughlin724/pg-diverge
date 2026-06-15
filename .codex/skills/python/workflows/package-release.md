<required_reading> Read:

1. `references/source-index.md`
2. `references/python-standards.md`
3. `references/tooling-templates.md`
4. `references/review-checklists.md` </required_reading>

<process>
1. Confirm the release scope from commits, changelog, public API changes, dependency changes, and user-visible behavior.
2. Apply SemVer only after identifying the public API. Patch for compatible fixes, minor for compatible features or deprecations, major for breaking public API changes.
3. Update changelog using stable categories: Added, Changed, Deprecated, Removed, Fixed, Security.
4. Build clean artifacts with `python -m build`. Validate artifacts before publishing.
5. Prefer PyPI Trusted Publishing through OIDC over long-lived API tokens when CI publishing is available.
6. For GitHub Actions publishing, grant only needed permissions, use trusted publisher configuration, and avoid interpolating untrusted event data into shell scripts.
7. Verify installability from built artifacts in a clean environment when packaging metadata or package data changed.
</process>

<success_criteria>

- Version, changelog, and public API changes agree.
- Build artifacts are clean and validated.
- Publishing auth uses short-lived trusted publishing where available.
- Release workflow passed or the manual release blocker is explicit. </success_criteria>
