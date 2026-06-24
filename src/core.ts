import type { SupaschemaConfig } from "./config/schema.js";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type ObjectKind =
  | "schema"
  | "extension"
  | "type"
  | "domain"
  | "enum"
  | "sequence"
  | "table"
  | "foreign-data-wrapper"
  | "foreign-server"
  | "foreign-table"
  | "constraint"
  | "index"
  | "function"
  | "procedure"
  | "view"
  | "materialized-view"
  | "trigger"
  | "rls"
  | "policy"
  | "grant"
  | "default-privilege"
  | "comment";

export interface ObjectRef {
  kind: ObjectKind;
  name: string;
  schema?: string;
  signature?: string;
  table?: string;
}

export interface Diagnostic {
  code: string;
  file?: string;
  hint?: string;
  message: string;
  ref?: ObjectRef;

  schemas?: string[];
  severity: DiagnosticSeverity;
  statement?: string;
}

export interface SchemaObject {
  dependencies: string[];
  file?: string;
  hash: string;
  key: string;
  metadata: Record<string, unknown>;
  normalizedSql: string;
  ordinal: number;
  ref: ObjectRef;
  sql: string;
}

export interface TableColumn {
  defaultExpression?: string;
  definition: string;
  generated?: boolean;
  generatedExpression?: string;
  hasDefault?: boolean;
  hasInlineConstraint?: boolean;
  identity?: boolean;
  name: string;
  notNull?: boolean;
  type?: string;
}

export interface SchemaModel {
  diagnostics: Diagnostic[];
  fingerprint: string;
  formatVersion?: number;
  objects: SchemaObject[];
  source: string;
}

export type MigrationOperationKind = "alter" | "create" | "replace" | "drop" | "rename";

export interface MigrationOperation {
  after?: SchemaObject;
  before?: SchemaObject;
  blocked: boolean;
  destructive: boolean;
  diagnostics: Diagnostic[];
  key: string;
  kind: MigrationOperationKind;
  metadata: Record<string, unknown>;
  ref: ObjectRef;
}

export interface MigrationPlan {
  diagnostics: Diagnostic[];
  fingerprint: string;
  from: string;

  fromFingerprint: string;
  operations: MigrationOperation[];
  to: string;

  toFingerprint: string;
}

export interface RenameHint {
  from: string;
  to: string;
}

export interface SupaschemaHints {
  allowedGrantees?: string[];
  destructive?: string[];
  renames?: RenameHint[];
  requiredPolicyColumns?: Record<string, string[]>;
}

export interface ExtractOptions {
  config?: Partial<SupaschemaConfig>;
  cwd?: string;
}

export interface RenderOptions {
  config?: Partial<SupaschemaConfig>;
  includeHeader?: boolean;
  version?: string;
}

export interface CheckOptions {
  config?: Partial<SupaschemaConfig>;
  cwd?: string;
  parse?: boolean;
}

export interface VerifyMigrationOptions {
  config?: Partial<SupaschemaConfig>;
  cwd?: string;
  databaseUrl: string;

  ensureEnvironment?: boolean;

  ensureRoles?: boolean;
  from: string;

  keepDatabases?: boolean;
  migrationPath: string;
  to: string;
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return;
  }
  return [...value];
}

export type { SupaschemaConfig } from "./config/schema.js";
