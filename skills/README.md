# supaschema Agent Skills

This directory exposes one portable public skill:

- `supaschema`: declarative schema and generated-migration workflow, with `references/` guides for setup and configuration, migration creation and adoption, drift detection and maintenance, and `SUPA_*` diagnostics.

Install it:

```bash
npx skills add https://github.com/jmclaughlin724/supaschema/tree/main/skills/supaschema
```

Do not point `npx skills` at the repository root. The Skills CLI discovers standard agent directories such as `.agents/skills` and `.claude/skills`; those directories contain repo-local maintainer mirrors for developing supaschema itself.

This lane installs Agent Skill context only into the location selected by the Skills CLI. It does not wire repository rules, hooks, config, schema directories, or migration directories. The npm package does not run this command during install; project enforcement is activated by `supaschema init`. For project setup, run this from the consuming project root:

```bash
npm install supaschema
```

If npm did not run lifecycle scripts, run:

```bash
npx supaschema init
```

`supaschema init` installs the packaged Agent and Claude skill directories, including references, plus the packaged rule and hook surfaces. It preserves conflicting files and reports preserved or skipped work from `node_modules/supaschema/agent-bundle/INSTALL.md`; it never creates `.codex/skills/**`.

The canonical skill source lives under `.claude/skills/supaschema`. The ordered export in `scripts/skills/sync-llm.mjs` owns the public inventory. Run `npm run sync:llm` after changing either source or inventory.
