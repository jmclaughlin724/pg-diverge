// Adjacent Supabase Edge Function (Deno runtime). supaschema has no awareness of
// edge functions: they are never diffed, checked, or typed. This file exists only
// so the sample mirrors a real Supabase CLI project layout. It targets the Deno
// runtime (the `Deno` global, web `Response`), not this repo's Node/TypeScript
// surface, so it is excluded from the Biome lint gate via a `files.includes`
// negation in `biome.jsonc`.
Deno.serve(() => Response.json({ message: "Hello from the supaschema sample project" }));
