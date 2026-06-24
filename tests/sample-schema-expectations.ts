export const expectedMigrationFragments = [
  "CREATE TYPE app.account_status AS ENUM ('active', 'suspended');",
  'ALTER TABLE "app"."accounts" ADD COLUMN IF NOT EXISTS "status"',
  "CREATE OR REPLACE VIEW app.account_names AS",
  "COMMENT ON TABLE app.accounts IS 'Customer accounts';",
];

export const expectedTypesFragments = [
  'account_status: "active" | "suspended";',
  'status: Database["app"]["Enums"]["account_status"];',
  'account_status: ["active", "suspended"],',
];

export const expectedZodFragments = [
  'const app_account_status = z.enum(["active", "suspended"]);',
  "status: app_account_status,",
  "export const Tables = {",
  "export const TablesInsert = {",
  "export const TablesUpdate = {",
  "export const Enums = {",
  "export type Tables<",
  "export type TablesInsert<",
  "export type Enums<",
];
