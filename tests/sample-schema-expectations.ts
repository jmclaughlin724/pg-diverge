// Shared oracle for the sample schema edit (add an enum, an enum-typed NOT NULL
// column, and a view) used by both the in-process unit test
// (tests/sample-supabase-migration.test.ts) and the installed-binary E2E
// (tests/consumer-lifecycle.test.ts). The two tests prove the SAME edit at
// different layers — the unit test the planner/renderer/typegen semantics, the
// E2E the real install + binary wiring — so the expected strings live here once.

// Fragments the rendered migration must contain (verified against `supaschema diff`).
export const expectedMigrationFragments = [
  "CREATE TYPE app.account_status AS ENUM ('active', 'suspended');",
  'ALTER TABLE "app"."accounts" ADD COLUMN IF NOT EXISTS "status"',
  "CREATE OR REPLACE VIEW app.account_names AS",
  "COMMENT ON TABLE app.accounts IS 'Customer accounts';",
] as const;

// Fragments the generated TypeScript types must contain.
export const expectedTypesFragments = [
  'account_status: "active" | "suspended";',
  'status: Database["app"]["Enums"]["account_status"];',
  'account_status: ["active", "suspended"],',
] as const;

// Fragments the generated Zod schemas must contain.
export const expectedZodFragments = [
  'const app_account_status = z.enum(["active", "suspended"]);',
  "status: app_account_status,",
] as const;
