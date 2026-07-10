export const expectedMigrationFragments = [
  "CREATE TYPE app.account_status AS ENUM ('active', 'suspended');",
  'ALTER TABLE "app"."accounts" ADD COLUMN IF NOT EXISTS "status"',
  "CREATE OR REPLACE VIEW app.account_names AS",
  "COMMENT ON TABLE app.accounts IS 'Customer accounts';",
];

export const expectedTypesFragments = [
  'export type AppAccountStatus = "active" | "suspended";',
  "status: AppAccountStatus;",
  "export type AppAccountsRow = {",
];

export const expectedZodFragments = [
  'export const AppAccountStatusSchema = z.enum(["active", "suspended"]);',
  "status: AppAccountStatusSchema,",
  "export const AppAccountsRowSchema =",
  "export const AppAccountsInsertSchema =",
  "export const AppAccountsUpdateSchema =",
];
