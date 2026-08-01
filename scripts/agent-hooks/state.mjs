import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultStateDir = path.join(projectRoot, ".tmp", "agent-hooks");
const fallbackTurnId = "turn-0";
const lockPollMs = 20;
const lockTimeoutMs = 8000;
const sessionEndLockTimeoutMs = 500;
const staleLockMs = 30_000;
const stateTtlMs = 24 * 60 * 60 * 1000;
const maxTurns = 20;
const maxEvidenceEntries = 50;
const directoryMode = 0o700;
const fileMode = 0o600;

export function stateDir() {
  return process.env.STATE_DIR ?? defaultStateDir;
}

export function sessionStatePath(payload) {
  const id = sessionId(payload);
  return path.join(stateDir(), `${Buffer.from(id).toString("base64url")}.json`);
}

export function validateSessionId(id) {
  if (id.length === 0 || id.length > 200) {
    throw new Error("invalid session id length");
  }
  for (const char of id) {
    if (char === "/" || char === "\\" || char === "\0") {
      throw new Error("invalid session id path character");
    }
  }
  if (id.includes("..")) {
    throw new Error("invalid session id traversal token");
  }
  return id;
}

export function readSessionState(payload) {
  return readStateRecord(payload).state;
}

export function writeSessionState(payload, state) {
  const normalized = normalizeState(state, sessionId(payload));
  normalized.updatedAt = now();
  writeStateFile(sessionStatePath(payload), normalized);
}

export function withSessionState(payload, callback) {
  return withSessionLock(payload, () => {
    const record = readStateRecord(payload);
    const before = JSON.stringify(record.state);
    const result = callback(record.state, { warning: record.warning });
    const next = normalizeState(result?.state ?? record.state, sessionId(payload));
    const changed = before !== JSON.stringify(next);
    if (changed || record.needsRepair) {
      next.updatedAt = now();
      writeStateFile(sessionStatePath(payload), next);
    }
    return result?.value;
  });
}

export function refreshSessionState(payload) {
  purgeLegacyHookState();
  withSessionLock(payload, () => {
    const state = emptyState(sessionId(payload));
    state.updatedAt = now();
    writeStateFile(sessionStatePath(payload), state);
  });
}

export function purgeLegacyHookState() {
  if (stateDir() !== defaultStateDir) {
    return 0;
  }
  let removed = 0;
  const legacySyncState = path.join(projectRoot, ".tmp", "sync-llm-on-claude-surface-change.json");
  if (unlinkIfPresent(legacySyncState)) {
    removed += 1;
  }
  if (!fs.existsSync(defaultStateDir)) {
    return removed;
  }
  for (const entry of fs.readdirSync(defaultStateDir, { withFileTypes: true })) {
    if (!(entry.isFile() && entry.name.endsWith(".json"))) {
      continue;
    }
    const file = path.join(defaultStateDir, entry.name);
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (isRecord(value) && Object.hasOwn(value, "contextEpoch") && unlinkIfPresent(file)) {
        removed += 1;
      }
    } catch {
      // Malformed current-format state remains visible to its owning session.
    }
  }
  return removed;
}

export function clearSessionState(payload) {
  withSessionLock(
    payload,
    () => {
      unlinkIfPresent(sessionStatePath(payload));
    },
    sessionEndLockTimeoutMs
  );
}

export function beginTurnState(payload, state) {
  const id = turnId(payload) ?? `prompt-${state.turnSequence + 1}`;
  if (!turnId(payload)) {
    state.turnSequence += 1;
  }
  state.currentTurnId = validateStateKey(id);
  state.turns[state.currentTurnId] = emptyTurn();
  pruneTurns(state);
  return currentTurnState(state);
}

export function selectTurnState(payload, state) {
  const id = turnId(payload);
  if (id) {
    state.currentTurnId = validateStateKey(id);
  }
  if (!state.currentTurnId) {
    state.currentTurnId = fallbackTurnId;
  }
  return currentTurnState(state);
}

export function currentTurnState(state) {
  if (!isRecord(state.turns)) {
    state.turns = {};
  }
  const id = state.currentTurnId || fallbackTurnId;
  state.currentTurnId = id;
  state.turns[id] ??= emptyTurn();
  return state.turns[id];
}

export function normalizeState(value, expectedSessionId = "default") {
  const session = validateSessionId(expectedSessionId);
  const turns = normalizeTurns(value?.turns);
  const currentTurnId =
    typeof value?.currentTurnId === "string" && value.currentTurnId.length > 0
      ? validateStateKey(value.currentTurnId)
      : fallbackTurnId;
  turns[currentTurnId] ??= emptyTurn();
  const boundedTurns = Object.fromEntries(Object.entries(turns).slice(-maxTurns));
  if (!boundedTurns[currentTurnId]) {
    delete boundedTurns[Object.keys(boundedTurns)[0]];
    boundedTurns[currentTurnId] = turns[currentTurnId];
  }
  trimEvidence(boundedTurns);
  return {
    createdAt: timestamp(value?.createdAt) ?? now(),
    currentTurnId,
    loadedSkills: normalizeLoadedSkills(value?.loadedSkills),
    sessionId: session,
    turnSequence: nonNegativeInteger(value?.turnSequence),
    turns: boundedTurns,
    updatedAt: timestamp(value?.updatedAt) ?? now(),
  };
}

export function addEvidence(state, evidence) {
  const domain = identifier(evidence?.domain);
  const outcome = evidence?.outcome === "success" ? "success" : "failure";
  if (!domain) {
    return;
  }
  const turn = currentTurnState(state);
  turn.evidence.push({ at: now(), domain, outcome });
  trimEvidence(state.turns);
}

function readStateRecord(payload) {
  const file = sessionStatePath(payload);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { needsRepair: false, state: emptyState(sessionId(payload)) };
    }
    return malformedState(payload, file, "read failure");
  }
  try {
    const parsed = JSON.parse(raw);
    assertPersistedState(parsed, sessionId(payload));
    if (Date.now() - Date.parse(parsed.updatedAt) > stateTtlMs) {
      unlinkIfPresent(file);
      return { needsRepair: false, state: emptyState(sessionId(payload)) };
    }
    fs.chmodSync(file, fileMode);
    return { needsRepair: false, state: normalizeState(parsed, sessionId(payload)) };
  } catch (error) {
    return malformedState(
      payload,
      file,
      error instanceof SyntaxError ? "invalid JSON" : "invalid schema"
    );
  }
}

function malformedState(payload, file, category) {
  return {
    needsRepair: true,
    state: emptyState(sessionId(payload)),
    warning: `Hook state warning: ignored ${category} in ${path.basename(file)} and continued with empty state.`,
  };
}

function assertPersistedState(value, expectedSessionId) {
  if (!isRecord(value)) {
    throw new Error("state must be an object");
  }
  if (value.sessionId !== expectedSessionId) {
    throw new Error("state session id mismatch");
  }
  if (!(timestamp(value.createdAt) && timestamp(value.updatedAt))) {
    throw new Error("state timestamps are invalid");
  }
  if (!(isRecord(value.turns) && isRecord(value.loadedSkills))) {
    throw new Error("state collections are invalid");
  }
}

function emptyState(id) {
  const time = now();
  return {
    createdAt: time,
    currentTurnId: fallbackTurnId,
    loadedSkills: {},
    sessionId: id,
    turnSequence: 0,
    turns: { [fallbackTurnId]: emptyTurn(time) },
    updatedAt: time,
  };
}

function emptyTurn(at = now()) {
  return { createdAt: at, evidence: [], pendingSkills: {} };
}

function normalizeTurns(value) {
  if (!isRecord(value)) {
    return {};
  }
  const entries = Object.entries(value).slice(-maxTurns);
  const turns = {};
  for (const [rawId, rawTurn] of entries) {
    const id = validateStateKey(rawId);
    turns[id] = {
      createdAt: timestamp(rawTurn?.createdAt) ?? now(),
      evidence: normalizeEvidence(rawTurn?.evidence),
      pendingSkills: normalizePendingSkills(rawTurn?.pendingSkills),
    };
  }
  return turns;
}

function normalizeLoadedSkills(value) {
  if (!isRecord(value)) {
    return {};
  }
  const loaded = {};
  for (const [rawName, rawAt] of Object.entries(value)) {
    const name = identifier(rawName);
    const at = timestamp(rawAt);
    if (name && at) {
      loaded[name] = at;
    }
  }
  return loaded;
}

function normalizePendingSkills(value) {
  if (!isRecord(value)) {
    return {};
  }
  const pending = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = identifier(rawName);
    const at = timestamp(rawValue?.at);
    const trigger = triggerCode(rawValue?.trigger);
    if (name && at && trigger) {
      pending[name] = { at, trigger };
    }
  }
  return pending;
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(-maxEvidenceEntries).flatMap((item) => {
    const at = timestamp(item?.at);
    const domain = identifier(item?.domain);
    const outcome = item?.outcome === "success" || item?.outcome === "failure" ? item.outcome : "";
    return at && domain && outcome ? [{ at, domain, outcome }] : [];
  });
}

function trimEvidence(turns) {
  let remaining = maxEvidenceEntries;
  const entries = Object.entries(turns);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const turn = entries[index][1];
    const evidence = Array.isArray(turn.evidence) ? turn.evidence : [];
    turn.evidence = evidence.slice(-remaining);
    remaining -= turn.evidence.length;
    if (remaining === 0) {
      for (let earlier = 0; earlier < index; earlier += 1) {
        entries[earlier][1].evidence = [];
      }
      break;
    }
  }
}

function pruneTurns(state) {
  const entries = Object.entries(state.turns);
  if (entries.length <= maxTurns) {
    return;
  }
  state.turns = Object.fromEntries(entries.slice(-maxTurns));
}

function writeStateFile(file, state) {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", fileMode);
    fs.writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    fs.chmodSync(file, fileMode);
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    unlinkIfPresent(temporary);
  }
}

function withSessionLock(payload, callback, timeoutMs = lockTimeoutMs) {
  const release = acquireSessionLock(payload, timeoutMs);
  try {
    return callback();
  } finally {
    release();
  }
}

function acquireSessionLock(payload, timeoutMs) {
  const lockPath = `${sessionStatePath(payload)}.lock`;
  ensurePrivateDirectory(path.dirname(lockPath));
  const startedAt = Date.now();
  while (true) {
    try {
      const descriptor = fs.openSync(lockPath, "wx", fileMode);
      fs.closeSync(descriptor);
      return () => unlinkIfPresent(lockPath);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      clearStaleLock(lockPath);
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`timed out waiting for session state lock: ${path.basename(lockPath)}`, {
          cause: error,
        });
      }
      sleep(lockPollMs);
    }
  }
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { mode: directoryMode, recursive: true });
  fs.chmodSync(directory, directoryMode);
}

function clearStaleLock(lockPath) {
  try {
    if (Date.now() - fs.statSync(lockPath).mtimeMs > staleLockMs) {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function unlinkIfPresent(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return false;
  }
}

function sessionId(payload) {
  const raw =
    payload?.session_id ??
    process.env.CLAUDE_SESSION_ID ??
    process.env.CODEX_SESSION_ID ??
    "default";
  return validateSessionId(String(raw || "default"));
}

function turnId(payload) {
  return typeof payload?.turn_id === "string" && payload.turn_id.length > 0
    ? payload.turn_id
    : undefined;
}

function validateStateKey(id) {
  return validateSessionId(id);
}

function identifier(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) {
    return "";
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const digit = code >= 48 && code <= 57;
    if (!(letter || digit || "_.:+-".includes(character))) {
      return "";
    }
  }
  return value;
}

function triggerCode(value) {
  return ["prompt-explicit", "prompt-keyword", "file-trigger"].includes(value) ? value : "";
}

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return;
  }
  return new Date(value).toISOString();
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function now() {
  return new Date().toISOString();
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
