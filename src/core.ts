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
  severity: DiagnosticSeverity;
  message: string;
  ref?: ObjectRef;
  file?: string;
  statement?: string;
  hint?: string;
  /** Schemas the failing statement references, for schema-filter scoping. */
  schemas?: string[];
}

export interface SchemaObject {
  ref: ObjectRef;
  key: string;
  sql: string;
  normalizedSql: string;
  hash: string;
  ordinal: number;
  file?: string;
  dependencies: string[];
  metadata: Record<string, unknown>;
}

export interface TableColumn {
  name: string;
  definition: string;
  type?: string;
  notNull?: boolean;
  hasDefault?: boolean;
  defaultExpression?: string;
  identity?: boolean;
  generated?: boolean;
  hasInlineConstraint?: boolean;
}

export interface SchemaModel {
  source: string;
  objects: SchemaObject[];
  diagnostics: Diagnostic[];
  fingerprint: string;
  formatVersion?: number;
}

export type MigrationOperationKind = "alter" | "create" | "replace" | "drop" | "rename";

export interface MigrationOperation {
  kind: MigrationOperationKind;
  ref: ObjectRef;
  key: string;
  before?: SchemaObject;
  after?: SchemaObject;
  destructive: boolean;
  blocked: boolean;
  diagnostics: Diagnostic[];
  metadata: Record<string, unknown>;
}

export interface MigrationPlan {
  from: string;
  to: string;
  operations: MigrationOperation[];
  diagnostics: Diagnostic[];
  fingerprint: string;

  fromFingerprint: string;

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
  databaseUrl: string;
  from: string;
  to: string;
  migrationPath: string;
  cwd?: string;
  config?: Partial<SupaschemaConfig>;

  ensureRoles?: boolean;
  /**
   * Stub Supabase-provisioned surfaces (auth schema helpers, cron schema) in
   * the temporary databases so real-world trees apply against bare
   * PostgreSQL. Defaults to false; enable explicitly with --ensure-environment.
   */
  ensureEnvironment?: boolean;
  /**
   * Keep the temporary databases after the run and report their names —
   * a failed verify leaves its evidence inspectable instead of dropped.
   */
  keepDatabases?: boolean;
}

export type { SupaschemaConfig } from "./config.js";
