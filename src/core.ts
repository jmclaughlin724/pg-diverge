import type { SupaschemaConfig } from "./config.js";

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
  /** Schemas the failing statement references, for schema-filter scoping. */
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
  destructive?: string[];
  renames?: RenameHint[];
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
  /**
   * Stub Supabase-provisioned surfaces (auth schema helpers, cron schema) in
   * the temporary databases so real-world trees apply against bare
   * PostgreSQL. Defaults to false; enable explicitly with --ensure-environment.
   */
  ensureEnvironment?: boolean;

  ensureRoles?: boolean;
  from: string;
  /**
   * Keep the temporary databases after the run and report their names —
   * a failed verify leaves its evidence inspectable instead of dropped.
   */
  keepDatabases?: boolean;
  migrationPath: string;
  to: string;
}

export type { SupaschemaConfig } from "./config.js";
