import fs from "node:fs";
import path from "node:path";

const defaultStateDir = path.resolve(".tmp", "agent-hooks");
const fallbackTurnId = "turn-0";
const lockPollMs = 20;
const lockTimeoutMs = 8000;
const staleLockMs = 30_000;
const maxTurns = 20;

export function stateDir() {
  return process.env.SUPASCHEMA_AGENT_HOOK_STATE_DIR ?? defaultStateDir;
}

export function sessionStatePath(payload) {
  const raw =
    payload?.session_id ??
    payload?.sessionId ??
    process.env.CLAUDE_SESSION_ID ??
    process.env.CODEX_SESSION_ID ??
    "default";
  const id = validateSessionId(String(raw || "default"));
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
  try {
    return normalizeState(JSON.parse(fs.readFileSync(sessionStatePath(payload), "utf8")));
  } catch {
    return normalizeState({});
  }
}

export function writeSessionState(payload, state) {
  const file = sessionStatePath(payload);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalizeState(state), null, 2)}\n`);
}

export function withSessionState(payload, callback) {
  const release = acquireSessionLock(payload);
  try {
    const state = readSessionState(payload);
    const result = callback(state);
    if (result?.clear) {
      clearSessionState(payload);
    } else if (result?.write !== false) {
      writeSessionState(payload, result?.state ?? state);
    }
    return result?.value;
  } finally {
    release();
  }
}

export function clearSessionState(payload) {
  fs.rmSync(sessionStatePath(payload), { force: true });
}

export function sessionStartState(payload, state) {
  const source = typeof payload?.source === "string" ? payload.source : "startup";
  if (source === "resume" || source === "compact") {
    return resetContextEpoch(state);
  }
  return normalizeState({});
}

export function beginTurnState(payload, state) {
  const id = turnId(payload);
  if (id) {
    state.currentTurnId = validateStateKey(id);
  } else {
    state.turnSequence += 1;
    state.currentTurnId = `prompt-${state.turnSequence}`;
  }
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
  const hasTurns = state.turns && typeof state.turns === "object" && !Array.isArray(state.turns);
  if (!hasTurns) {
    state.turns = {};
  }
  const id = state.currentTurnId || fallbackTurnId;
  state.currentTurnId = id;
  if (!state.turns[id]) {
    state.turns[id] = emptyTurn();
  }
  return state.turns[id];
}

export function normalizeState(value) {
  const turns = normalizeTurns(value?.turns);
  const currentTurnId =
    typeof value?.currentTurnId === "string" && value.currentTurnId.length > 0
      ? validateStateKey(value.currentTurnId)
      : fallbackTurnId;
  if (!turns[currentTurnId]) {
    turns[currentTurnId] = emptyTurn();
  }
  const currentTurn = turns[currentTurnId] ?? emptyTurn();
  return {
    atlasAdvisories: currentTurn.atlasAdvisories,
    contextEpoch: integerValue(value?.contextEpoch),
    corrections: currentTurn.corrections,
    currentTurnId,
    evidence: currentTurn.evidence,
    invokedSkills: objectValue(value?.invokedSkills),
    lastPrompt: currentTurn.lastPrompt,
    pendingSkills: currentTurn.pendingSkills,
    turnSequence: integerValue(value?.turnSequence),
    turns,
  };
}

export function addEvidence(state, evidence) {
  const turn = currentTurnState(state);
  turn.evidence = [...turn.evidence, { at: new Date().toISOString(), ...evidence }].slice(-50);
}

export function setCorrections(state, findings) {
  const turn = currentTurnState(state);
  const blocked = new Set(
    turn.corrections.filter((item) => item.blocked).map((item) => correctionSignature(item))
  );
  turn.corrections = findings.map((finding) => ({
    blocked: blocked.has(correctionSignature(finding)),
    ...finding,
  }));
}

function correctionSignature(item) {
  return JSON.stringify([item.id, item.message ?? ""]);
}

function resetContextEpoch(state) {
  return {
    ...normalizeState(state),
    contextEpoch: integerValue(state?.contextEpoch) + 1,
    currentTurnId: "",
    invokedSkills: {},
  };
}

function normalizeTurns(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const turns = {};
  for (const [id, turn] of Object.entries(value)) {
    turns[validateStateKey(id)] = {
      atlasAdvisories: objectValue(turn?.atlasAdvisories),
      corrections: Array.isArray(turn?.corrections) ? turn.corrections : [],
      evidence: Array.isArray(turn?.evidence) ? turn.evidence : [],
      lastPrompt: typeof turn?.lastPrompt === "string" ? turn.lastPrompt : "",
      pendingSkills: objectValue(turn?.pendingSkills),
    };
  }
  return turns;
}

function emptyTurn() {
  return {
    atlasAdvisories: {},
    corrections: [],
    evidence: [],
    lastPrompt: "",
    pendingSkills: {},
  };
}

function pruneTurns(state) {
  const entries = Object.entries(state.turns);
  if (entries.length <= maxTurns) {
    return;
  }
  state.turns = Object.fromEntries(entries.slice(-maxTurns));
  if (!state.turns[state.currentTurnId]) {
    state.currentTurnId = entries.at(-1)?.[0] ?? fallbackTurnId;
  }
}

function turnId(payload) {
  const raw = payload?.turn_id ?? payload?.turnId;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function validateStateKey(id) {
  return validateSessionId(id);
}

function integerValue(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function acquireSessionLock(payload) {
  const lockPath = `${sessionStatePath(payload)}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return () => fs.rmSync(lockPath, { force: true, recursive: true });
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      clearStaleLock(lockPath);
      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(`timed out waiting for session state lock: ${path.basename(lockPath)}`);
      }
      sleep(lockPollMs);
    }
  }
}

function clearStaleLock(lockPath) {
  try {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (ageMs > staleLockMs) {
      fs.rmSync(lockPath, { force: true, recursive: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
