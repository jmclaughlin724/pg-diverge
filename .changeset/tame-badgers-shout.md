---
"supaschema": minor
---

Embed build identity (version, commit, build time, tree state) in the published package as `dist/build-info.json`, report it in `supaschema doctor`, and warn on stderr when the CLI runs as an unreleased build or from a checkout whose compiled `dist` is older than `src` (`SUPA_BUILD_STALE_DIST`). `--version` output is unchanged; the warnings never fail the command and can be suppressed with `--quiet` or `SUPASCHEMA_SUPPRESS_BUILD_WARNING=1`.
