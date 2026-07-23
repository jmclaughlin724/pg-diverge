import fs from "node:fs";
import path from "node:path";

const defaultStateDir = path.resolve(".tmp", "agent-hooks");
const fallbackTurnId = "turn-0";
const lockPollMs = 20;
const lockTimeoutMs = 8000;
const staleLockMs = 30_000;
const maxTurns = 20;
const maxCorrectionEntries = 20;

export function stateDir() {
  return process.env.STATE_DIR ?? defaultStateDir;
}

export function sessionStatePath(payload) {
  const raw =
    payload?.session_id ??
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
  resetMainCorrectionsForPrompt(payload, state);
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
    currentTurnId,
    evidence: currentTurn.evidence,
    invokedSkills: objectValue(value?.invokedSkills),
    lastPrompt: currentTurn.lastPrompt,
    pendingSkills: currentTurn.pendingSkills,
    responseCorrections: normalizeResponseCorrections(value?.responseCorrections),
    turnSequence: integerValue(value?.turnSequence),
    turns,
  };
}

export function addEvidence(state, evidence) {
  const turn = currentTurnState(state);
  turn.evidence = [...turn.evidence, { at: new Date().toISOString(), ...evidence }].slice(-50);
}

export function correctionsFor(payload, state) {
  return correctionLedger(state)[correctionScope(payload)]?.findings ?? [];
}

export function setCorrections(payload, state, findings) {
  const scope = correctionScope(payload);
  if (findings.length === 0) {
    delete correctionLedger(state)[scope];
    return [];
  }

  const existing = correctionLedger(state)[scope] ?? emptyCorrectionEntry();
  const emitted = new Set(existing.emittedSignatures);
  const normalizedFindings = findings.map((finding) => ({
    blocked: emitted.has(correctionSignature(finding)),
    ...finding,
  }));
  storeCorrectionEntry(state, scope, {
    ...existing,
    findings: normalizedFindings,
  });
  return normalizedFindings;
}

export function markCorrectionsBlocked(payload, state, continuationPrompt) {
  const scope = correctionScope(payload);
  const existing = correctionLedger(state)[scope];
  if (!existing) {
    return;
  }
  const findings = existing.findings.map((finding) => ({ ...finding, blocked: true }));
  const emittedSignatures = [
    ...new Set([
      ...existing.emittedSignatures,
      ...findings.map((finding) => correctionSignature(finding)),
    ]),
  ].slice(-maxCorrectionEntries);
  storeCorrectionEntry(state, scope, {
    continuationPrompt,
    emittedSignatures,
    findings,
  });
}

export function clearCorrections(payload, state) {
  delete correctionLedger(state)[correctionScope(payload)];
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
    responseCorrections: {},
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
    evidence: [],
    lastPrompt: "",
    pendingSkills: {},
  };
}

function correctionScope(payload) {
  const agentId = typeof payload?.agent_id === "string" ? payload.agent_id : "";
  return agentId ? `agent:${validateStateKey(agentId)}` : "main";
}

function correctionLedger(state) {
  state.responseCorrections ??= {};
  return state.responseCorrections;
}

function emptyCorrectionEntry() {
  return {
    continuationPrompt: "",
    emittedSignatures: [],
    findings: [],
  };
}

function storeCorrectionEntry(state, scope, entry) {
  const ledger = correctionLedger(state);
  delete ledger[scope];
  ledger[scope] = entry;
  const entries = Object.entries(ledger);
  if (entries.length > maxCorrectionEntries) {
    state.responseCorrections = Object.fromEntries(entries.slice(-maxCorrectionEntries));
  }
}

function resetMainCorrectionsForPrompt(payload, state) {
  const main = correctionLedger(state).main;
  if (!main) {
    return;
  }
  const prompt = typeof payload?.prompt === "string" ? payload.prompt : "";
  if (prompt !== main.continuationPrompt) {
    clearCorrections(payload, state);
  }
}

function normalizeResponseCorrections(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = [];
  for (const [rawScope, rawEntry] of Object.entries(value).slice(-maxCorrectionEntries)) {
    const scope = normalizeCorrectionScope(rawScope);
    if (
      scope === undefined ||
      rawEntry === null ||
      typeof rawEntry !== "object" ||
      Array.isArray(rawEntry)
    ) {
      continue;
    }
    const emittedSignatures = Array.isArray(rawEntry.emittedSignatures)
      ? rawEntry.emittedSignatures
          .filter((signature) => typeof signature === "string")
          .slice(-maxCorrectionEntries)
      : [];
    const findings = Array.isArray(rawEntry.findings)
      ? rawEntry.findings
          .filter(
            (finding) =>
              finding &&
              typeof finding === "object" &&
              !Array.isArray(finding) &&
              typeof finding.id === "string" &&
              typeof finding.message === "string"
          )
          .map((finding) => ({
            blocked: Boolean(finding.blocked),
            id: finding.id,
            message: finding.message,
          }))
      : [];
    entries.push([
      scope,
      {
        continuationPrompt:
          typeof rawEntry.continuationPrompt === "string" ? rawEntry.continuationPrompt : "",
        emittedSignatures,
        findings,
      },
    ]);
  }
  return Object.fromEntries(entries);
}

function normalizeCorrectionScope(scope) {
  if (scope === "main") {
    return scope;
  }
  if (!scope.startsWith("agent:")) {
    return;
  }
  try {
    return `agent:${validateStateKey(scope.slice("agent:".length))}`;
  } catch {
    // Invalid persisted actor scopes are discarded during normalization.
  }
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
  const raw = payload?.turn_id;
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
        throw new Error(`timed out waiting for session state lock: ${path.basename(lockPath)}`, {
          cause: error,
        });
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
