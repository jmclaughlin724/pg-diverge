import fs from "node:fs";
import path from "node:path";

const defaultStateDir = path.resolve(".tmp", "agent-hooks");

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

export function clearSessionState(payload) {
  fs.rmSync(sessionStatePath(payload), { force: true });
}

export function normalizeState(value) {
  return {
    corrections: Array.isArray(value?.corrections) ? value.corrections : [],
    evidence: Array.isArray(value?.evidence) ? value.evidence : [],
    invokedSkills: objectValue(value?.invokedSkills),
    lastPrompt: typeof value?.lastPrompt === "string" ? value.lastPrompt : "",
    pendingSkills: objectValue(value?.pendingSkills),
  };
}

export function addEvidence(state, evidence) {
  state.evidence = [...state.evidence, { at: new Date().toISOString(), ...evidence }].slice(-50);
}

export function setCorrections(state, findings) {
  const existing = new Map(state.corrections.map((item) => [item.id, item]));
  state.corrections = findings.map((finding) => ({
    firstSeenAt: existing.get(finding.id)?.firstSeenAt ?? new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...finding,
  }));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
