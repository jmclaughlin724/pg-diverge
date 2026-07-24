import type { ObjectKind, SchemaObject } from "../types.js";
import type { AstStatement } from "./ast.js";
import { asRecord, readArray, readString } from "./ast.js";

export interface UnsupportedStatementSupport {
  boundary: string;
  hint: string;
  nodeKinds?: readonly string[];
  tags: readonly string[];
}

export interface ModeledObjectSupport {
  kind: ObjectKind;
  label: string;
  statementTags: readonly string[];
}

export const modeledObjectSupport: readonly ModeledObjectSupport[] = [
  { kind: "schema", label: "Schemas", statementTags: ["CreateSchemaStmt"] },
  { kind: "extension", label: "Extensions", statementTags: ["CreateExtensionStmt"] },
  { kind: "type", label: "Types/enums", statementTags: ["CompositeTypeStmt", "CreateRangeStmt"] },
  { kind: "enum", label: "Types/enums", statementTags: ["CreateEnumStmt"] },
  { kind: "domain", label: "Domains", statementTags: ["CreateDomainStmt"] },
  { kind: "sequence", label: "Sequences", statementTags: ["CreateSeqStmt", "AlterSeqStmt"] },
  { kind: "table", label: "Tables", statementTags: ["CreateStmt", "AlterTableStmt"] },
  {
    kind: "foreign-data-wrapper",
    label: "Foreign data wrappers",
    statementTags: ["CreateFdwStmt"],
  },
  { kind: "foreign-server", label: "Foreign servers", statementTags: ["CreateForeignServerStmt"] },
  { kind: "foreign-table", label: "Foreign tables", statementTags: ["CreateForeignTableStmt"] },
  { kind: "constraint", label: "Constraints", statementTags: ["AlterTableStmt"] },
  { kind: "index", label: "Indexes", statementTags: ["IndexStmt"] },
  { kind: "function", label: "Functions/procedures", statementTags: ["CreateFunctionStmt"] },
  { kind: "procedure", label: "Functions/procedures", statementTags: ["CreateFunctionStmt"] },
  { kind: "view", label: "Views", statementTags: ["ViewStmt"] },
  { kind: "materialized-view", label: "Materialized views", statementTags: ["CreateTableAsStmt"] },
  { kind: "trigger", label: "Triggers", statementTags: ["CreateTrigStmt"] },
  { kind: "rls", label: "RLS", statementTags: ["AlterTableStmt"] },
  { kind: "policy", label: "Policies", statementTags: ["CreatePolicyStmt"] },
  { kind: "grant", label: "Grants/default privileges", statementTags: ["GrantStmt"] },
  {
    kind: "default-privilege",
    label: "Grants/default privileges",
    statementTags: ["AlterDefaultPrivilegesStmt"],
  },
  { kind: "comment", label: "Comments", statementTags: ["CommentStmt"] },
];

export const sourceIntentStatementTags = new Set([
  "CallStmt",
  "DeleteStmt",
  "DoStmt",
  "InsertStmt",
  "RefreshMatViewStmt",
  "SelectStmt",
  "UpdateStmt",
]);

export const ignoredStatementTags = new Set(["TransactionStmt"]);

export const unsupportedStatementSupport: readonly UnsupportedStatementSupport[] = [
  {
    boundary: "Publications/subscriptions",
    hint: "Logical replication setup is operational and environment-specific; keep it in an explicit reviewed migration.",
    tags: [
      "AlterPublicationStmt",
      "AlterSubscriptionStmt",
      "CreatePublicationStmt",
      "CreateSubscriptionStmt",
    ],
  },
  {
    boundary: "Event triggers",
    hint: "Cluster-level trigger behavior is outside declarative application schema ownership; keep it in an explicit reviewed migration.",
    tags: ["CreateEventTrigStmt"],
  },
  {
    boundary: "Collations",
    hint: "Collation availability and locale behavior are cluster/provider-owned; keep it in an explicit reviewed migration.",
    nodeKinds: ["OBJECT_COLLATION"],
    tags: ["AlterCollationStmt", "DefineStmt"],
  },
  {
    boundary: "Definitions without declarative model",
    hint: "This parser DefineStmt form is not a modeled declarative object; keep it in an explicit reviewed migration.",
    tags: ["DefineStmt"],
  },
  {
    boundary: "Credential and cluster-scoped objects",
    hint: "Credentials, roles, tablespaces, casts, conversions, access methods, and operator families/classes are not declarative application schema objects.",
    tags: [
      "AlterOwnerStmt",
      "CreateAmStmt",
      "CreateCastStmt",
      "CreateConversionStmt",
      "CreateOpClassStmt",
      "CreateOpFamilyStmt",
      "CreateTableSpaceStmt",
      "CreateUserMappingStmt",
    ],
  },
  {
    boundary: "Rules/statistics/security labels",
    hint: "Rules, extended statistics, and security labels need catalog extraction and replay semantics before declarative ownership.",
    tags: ["CreateStatsStmt", "RuleStmt", "SecLabelStmt"],
  },
];

const unsupportedByTag = new Map<string, UnsupportedStatementSupport[]>();
for (const item of unsupportedStatementSupport) {
  for (const tag of item.tags) {
    unsupportedByTag.set(tag, [...(unsupportedByTag.get(tag) ?? []), item]);
  }
}

const deparseGapObjectKinds = new Set<ObjectKind>([
  "constraint",
  "default-privilege",
  "foreign-data-wrapper",
  "grant",
]);

export function unsupportedStatement(
  tag: string,
  node?: Record<string, unknown>
): UnsupportedStatementSupport | undefined {
  const candidates = unsupportedByTag.get(tag) ?? [];
  if (candidates.length === 0) {
    return;
  }
  const nodeKind = readString(node?.kind);
  for (const support of candidates) {
    if (nodeKind && support.nodeKinds?.includes(nodeKind)) {
      return support;
    }
  }
  return candidates.find((item) => !item.nodeKinds);
}

export function modeledStatementTags(): string[] {
  return [...new Set(modeledObjectSupport.flatMap((item) => item.statementTags))].sort(
    (left, right) => left.localeCompare(right)
  );
}

export function knownStatementTags(): string[] {
  return [
    ...modeledStatementTags(),
    ...sourceIntentStatementTags,
    ...ignoredStatementTags,
    ...unsupportedByTag.keys(),
  ].sort((left, right) => left.localeCompare(right));
}

export function hasKnownObjectDeparseGap(
  object: SchemaObject,
  statements: readonly AstStatement[]
): boolean {
  return (
    deparseGapObjectKinds.has(object.ref.kind) ||
    statements.some((statement) => hasKnownStatementDeparseGap(statement))
  );
}

export function hasKnownStatementDeparseGap(statement: AstStatement): boolean {
  const node = asRecord(statement.node[statement.tag]);
  if (!node) {
    return false;
  }
  if (statement.tag === "GrantStmt") {
    return true;
  }
  if (statement.tag === "CreateFdwStmt") {
    return true;
  }
  if (statement.tag === "DropStmt") {
    return readString(node.removeType) === "OBJECT_POLICY";
  }
  if (statement.tag === "AlterTableStmt") {
    return readArray(node.cmds).some((item) => {
      const command = asRecord(asRecord(item)?.AlterTableCmd);
      return readString(command?.subtype) === "AT_AttachPartition";
    });
  }
  return false;
}
