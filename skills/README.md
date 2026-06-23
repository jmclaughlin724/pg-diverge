# supaschema Agent Skill

This directory is the public `npx skills` source for supaschema.

Install only the portable skill:

```bash
npx skills add https://github.com/jmclaughlin724/supaschema/tree/main/skills/supaschema
```

Or list the public skill package:

```bash
npx skills add https://github.com/jmclaughlin724/supaschema/tree/main/skills --list
```

Do not point `npx skills` at the repository root. The Skills CLI discovers standard agent directories such as `.agents/skills` and `.claude/skills`; those directories contain repo-local maintainer mirrors for developing supaschema itself.

This lane installs Agent Skill context only into the location selected by the Skills CLI. It does not wire repository rules, hooks, config, schema directories, or migration directories. The npm package does not run this command during install and does not activate agent surfaces by default. For project setup, run this from the consuming project root:

```bash
npm install supaschema
```

If npm did not run lifecycle scripts, run:

```bash
npx supaschema init
```

`supaschema init` reports the packaged agent bundle location for reviewed manual installation when a project chooses to activate those surfaces.

The canonical skill source is `.claude/skills/supaschema/SKILL.md`. Run `npm run sync:llm` after changing it; the sync command refreshes `skills/supaschema` and `.agents/skills/supaschema`.
