---
"supaschema": patch
---

Make the bundled Claude rule consumer-safe: point source-boundary guidance at the packaged offline `agent-bundle/docs/concepts/sources.mdx` instead of implementation-repo paths, and scope the `src/sql/support.ts` wiring and `npm run typecheck` verification requirements to developing supaschema itself, with consumer projects directed to the packaged docs, `supaschema explain`, and their own package scripts.
