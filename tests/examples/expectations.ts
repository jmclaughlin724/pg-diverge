export const expectedMigrationFragments = [
  "CREATE TYPE app.account_status AS ENUM ('active', 'suspended');",
  'ALTER TABLE "app"."accounts" ADD COLUMN IF NOT EXISTS "status"',
  "CREATE OR REPLACE VIEW app.account_names AS",
  "COMMENT ON TABLE app.accounts IS 'Customer accounts';",
];

export const expectedTypesFragments = [
  "export type Database = {",
  'account_status: "active" | "suspended";',
  'status: Database["app"]["Enums"]["account_status"];',
  "accounts: {",
];

export const expectedZodFragments = [
  "export const SupaschemaZod",
  'account_status: z.enum(["active", "suspended"]),',
  'status: z.lazy(() => SupaschemaZod["app"]["Enums"]["account_status"]),',
  "accounts: {",
  "Row: z.object({",
  "Insert: z.object({",
  "Update: z.object({",
];
