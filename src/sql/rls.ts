import { formatQualifiedName } from "./identifiers.js";

export type RlsTransitionSubtype =
  | "AT_DisableRowSecurity"
  | "AT_EnableRowSecurity"
  | "AT_ForceRowSecurity"
  | "AT_NoForceRowSecurity";

export const rlsTransitionSubtypes: readonly RlsTransitionSubtype[] = [
  "AT_EnableRowSecurity",
  "AT_DisableRowSecurity",
  "AT_ForceRowSecurity",
  "AT_NoForceRowSecurity",
];

const rlsTransitionSubtypeSet: ReadonlySet<string> = new Set(rlsTransitionSubtypes);

export interface RlsState {
  rlsEnabled: boolean;
  rlsForced: boolean;
}

export const defaultRlsState: RlsState = {
  rlsEnabled: false,
  rlsForced: false,
};

export function isRlsTransitionSubtype(value: unknown): value is RlsTransitionSubtype {
  return typeof value === "string" && rlsTransitionSubtypeSet.has(value);
}

export function applyRlsTransition(state: RlsState, transition: RlsTransitionSubtype): RlsState {
  switch (transition) {
    case "AT_EnableRowSecurity":
      return { ...state, rlsEnabled: true };
    case "AT_DisableRowSecurity":
      return { ...state, rlsEnabled: false };
    case "AT_ForceRowSecurity":
      return { ...state, rlsForced: true };
    case "AT_NoForceRowSecurity":
      return { ...state, rlsForced: false };
    default:
      return state;
  }
}

export function rlsStateFromMetadata(metadata: Record<string, unknown>): RlsState | undefined {
  if (typeof metadata.rlsEnabled === "boolean" && typeof metadata.rlsForced === "boolean") {
    return {
      rlsEnabled: metadata.rlsEnabled,
      rlsForced: metadata.rlsForced,
    };
  }
}

export function rlsStateFromObjectMetadata(
  metadata: Record<string, unknown>
): RlsState | undefined {
  const state = rlsStateFromMetadata(metadata);
  if (state) {
    return state;
  }
  if (isRlsTransitionSubtype(metadata.rlsTransition)) {
    return applyRlsTransition(defaultRlsState, metadata.rlsTransition);
  }
}

export function rlsStateSql(schema: string | undefined, table: string, state: RlsState): string {
  return renderRlsStateTransition(schema, table, defaultRlsState, state);
}

export function renderRlsStateTransition(
  schema: string | undefined,
  table: string,
  before: RlsState,
  after: RlsState
): string {
  const target = formatQualifiedName(schema, table);
  const statements: string[] = [];
  if (before.rlsForced && !after.rlsForced) {
    statements.push(`ALTER TABLE ${target} NO FORCE ROW LEVEL SECURITY`);
  }
  if (!before.rlsEnabled && after.rlsEnabled) {
    statements.push(`ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`);
  }
  if (before.rlsEnabled && !after.rlsEnabled) {
    statements.push(`ALTER TABLE ${target} DISABLE ROW LEVEL SECURITY`);
  }
  if (!before.rlsForced && after.rlsForced) {
    statements.push(`ALTER TABLE ${target} FORCE ROW LEVEL SECURITY`);
  }
  return statements.join(";\n");
}
