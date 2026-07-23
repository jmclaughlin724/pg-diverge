# supaschema Agent Skills

This directory exposes three portable public skills:

- `supaschema`: core declarative schema and generated-migration policy
- `supaschema-migrate`: onboarding and schema-change execution
- `supaschema-maintain`: drift detection, checks, types, and maintenance review

Install one skill:

```bash
npx skills add https://github.com/jmclaughlin724/supaschema/tree/main/skills/supaschema
```

Replace the final directory with `supaschema-migrate` or `supaschema-maintain` for those focused workflows. To list all three:

```bash
npx skills add https://github.com/jmclaughlin724/supaschema/tree/main/skills --list
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

`supaschema init` installs all three packaged Agent and Claude skill directories, including references, plus the packaged rule and hook surfaces. It preserves conflicting files and reports preserved or skipped work from `node_modules/supaschema/agent-bundle/INSTALL.md`; it never creates `.codex/skills/**`.

Canonical skill sources live under `.claude/skills/{supaschema,supaschema-migrate,supaschema-maintain}`. The ordered export in `scripts/skills/sync-llm.mjs` owns the public inventory. Run `npm run sync:llm` after changing either source or inventory.
