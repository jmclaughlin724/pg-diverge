export const meta = {
  name: "code-review",
  description: "Workflow-backed code review — one finder agent per review angle, an independent verifier for every candidate, then a ranked, capped findings report.",
  whenToUse: "Launched by the /code-review skill at high, xhigh, or max effort when workflows are enabled. Pass args as \"<level> [target]\" — level is high, xhigh, or max; target is an optional PR number, branch, ref range, path, or free-form review instructions (e.g. \"only review src/foo.ts\", \"focus on error handling\").",
  phases: [{"title":"Scope","detail":"Pin the diff command, changed files, applicable CLAUDE.md files, and conventions"},{"title":"Find","detail":"One finder agent per review angle (correctness + cleanup + conventions), streaming into verify"},{"title":"Verify","detail":"One independent verifier per candidate — CONFIRMED / PLAUSIBLE / REFUTED"},{"title":"Sweep","detail":"Fresh finder hunting only for gaps (xhigh/max)"},{"title":"Synthesize","detail":"Merge duplicates, rank, cap the report"}],
}

// code-review: Scope → pipeline(per-angle Find → Verify) → Sweep (xhigh/max) → Synthesize
// Effort parameterization mirrors the inline /code-review cells:
//   high  → 3 correctness + 5 cleanup angles × 6 → ≤10 findings
//   xhigh → 5 correctness + 5 cleanup angles × 8 → sweep → ≤15 findings
//   max   → same structure as xhigh (the API reasoning effort differs, not the fan-out)
const LEVEL_PARAMS = {
  high: { correctnessAngles: 3, perAngle: 6, maxFindings: 10, sweep: false },
  xhigh: { correctnessAngles: 5, perAngle: 8, maxFindings: 15, sweep: true },
  max: { correctnessAngles: 5, perAngle: 8, maxFindings: 15, sweep: true },
}
const SWEEP_MAX = 8

const RAW_ARGS = (typeof args === "string" ? args : "").trim()
const ARG_TOKENS = RAW_ARGS.split(/\s+/).filter(Boolean)
const FLAG_FIX = ARG_TOKENS.some(token => token === "--fix")
const FLAG_COMMENT = ARG_TOKENS.some(token => token === "--comment")
const POSITIONAL_ARGS = ARG_TOKENS.filter(token => token !== "--fix" && token !== "--comment")
const FIRST = POSITIONAL_ARGS[0] || ""
// Own-property check so Object.prototype keys ("constructor", "toString") never parse as a level.
const FIRST_IS_LEVEL = Object.prototype.hasOwnProperty.call(LEVEL_PARAMS, FIRST)
const LEVEL = FIRST_IS_LEVEL ? FIRST : "high"
const TARGET = FIRST_IS_LEVEL ? POSITIONAL_ARGS.slice(1).join(" ").trim() : POSITIONAL_ARGS.join(" ").trim()
const P = LEVEL_PARAMS[LEVEL]
const FLAG_INSTRUCTIONS =
  (FLAG_FIX
    ? "\n## Applying fixes (--fix)\nThe `--fix` flag was passed. After producing the findings list, apply the findings to the working tree instead of stopping at the report: fix each one directly when the fix is local and intended. Skip any finding whose fix would change intended behavior, require changes well outside the reviewed diff, or is judged false positive; note the skip.\n"
    : "") +
  (FLAG_COMMENT
    ? "\n## Posting to GitHub (--comment)\nThe `--comment` flag was passed. After producing the findings list, post findings as inline PR comments when the target is a GitHub PR and a comment tool or `gh api` is available; otherwise print the findings and note that inline posting was unavailable.\n"
    : "")

// Prompt fragments shared with the inline /code-review cells (one source of truth).
const CORRECTNESS_ANGLES = [{"label":"angle-A","text":"### Angle A — line-by-line diff scan\n\nRead every hunk in the diff, line by line. Then Read the enclosing function for\neach hunk — bugs in unchanged lines of a touched function are in scope (the PR\nre-exposes or fails to fix them). For every line ask: what input, state, timing,\nor platform makes this line wrong? Look for inverted/wrong conditions,\noff-by-one, null/undefined deref, missing `await`, falsy-zero checks,\nwrong-variable copy-paste, error swallowed in catch, unescaped regex metachars.\n"},{"label":"angle-B","text":"### Angle B — removed-behavior auditor\n\nFor every line the diff DELETES or replaces, name the invariant or behavior it\nenforced, then search the new code for where that invariant is re-established.\nIf you can't find it, that's a candidate: a removed guard, a dropped error\npath, a narrowed validation, a deleted test that was covering a real case.\n"},{"label":"angle-C","text":"### Angle C — cross-file tracer\n\nFor each function the diff changes, find its callers (Grep for the symbol) and\ncheck whether the change breaks any call site: a new precondition, a changed\nreturn shape, a new exception, a timing/ordering dependency. Also check callees:\ndoes a parallel change in the same PR make a call unsafe?\n"},{"label":"angle-D","text":"### Angle D — language-pitfall specialist\n\nScan for the classic pitfalls of the diff's language/framework — for example:\nJS falsy-zero, `==` coercion, closure-captured loop var; Python mutable default\nargs, late-binding closures; Go nil-map write, range-var capture; SQL injection;\ntimezone/DST drift; float equality. Flag any instance the diff introduces.\n"},{"label":"angle-E","text":"### Angle E — wrapper/proxy correctness\n\nWhen the PR adds or modifies a type that wraps another (cache, proxy, decorator,\nadapter): check that every method routes to the wrapped instance and not back\nthrough a registry/session/global — e.g. a caching provider holding a\n`delegate` field that resolves IDs via `session.get(...)` instead of\n`delegate.get(...)` will re-enter the cache or recurse. Also check that the\nwrapper forwards all the methods the callers actually use.\n"}]
const CLEANUP_ANGLES = [{"label":"reuse","text":"### Reuse\n\nFlag new code that re-implements something the codebase\nalready has — Grep shared/utility modules and files adjacent to the change,\nand name the existing helper to call instead.\n"},{"label":"simplification","text":"### Simplification\n\nFlag unnecessary complexity the diff adds: redundant or derivable state,\ncopy-paste with slight variation, deep nesting, dead code left behind. Name\nthe simpler form that does the same job.\n"},{"label":"efficiency","text":"### Efficiency\n\nFlag wasted work the diff introduces: redundant computation or repeated I/O,\nindependent operations run sequentially, blocking work added to startup or\nhot paths. Also flag long-lived objects built from closures or captured\nenvironments — they keep the entire enclosing scope alive for the object's\nlifetime (a memory leak when that scope holds large values); prefer a\nclass/struct that copies only the fields it needs. Name the cheaper\nalternative.\n"},{"label":"altitude","text":"### Altitude\n\nCheck that each change is implemented at the right depth, not as a fragile\nbandaid. Special cases layered on shared infrastructure are a sign the fix\nisn't deep enough — prefer generalizing the underlying mechanism over adding\nspecial cases.\n"},{"label":"conventions","text":"### Conventions (CLAUDE.md)\n\nFind the CLAUDE.md files that govern the changed code: the user-level\n~/.claude/CLAUDE.md, the repo-root CLAUDE.md, plus any CLAUDE.md or\nCLAUDE.local.md in a directory that is an ancestor of a changed file (a\ndirectory's CLAUDE.md only applies to files at or below it). Read each one\nthat exists, then check the diff for clear violations of the rules they state.\n\nOnly flag a violation when you can quote the exact rule and the exact line\nthat breaks it — no style preferences, no vague \"spirit of the doc\"\ninferences. In the finding, name the CLAUDE.md path and quote the rule so the\nreport can cite it. If no CLAUDE.md applies, return nothing for this angle.\n"}]
const VERDICT_LADDER = "- **CONFIRMED** — can name the inputs/state that trigger it and the wrong\n  output or crash. Quote the line.\n- **PLAUSIBLE** — mechanism is real, trigger is uncertain (timing, env,\n  config). State what would confirm it.\n- **REFUTED** — factually wrong (code doesn't say that) or guarded elsewhere.\n  Quote the line that proves it."
const VERDICT_LADDER_RECALL = "**PLAUSIBLE by default** — do not refute a candidate for being \"speculative\" or\n\"depends on runtime state\" when the state is realistic: concurrency races,\nnil/undefined on a rare-but-reachable path (error handler, cold cache, missing\noptional field), falsy-zero treated as missing, off-by-one on a boundary the\ncode does not exclude, retry storms / partial failures, regex/allowlist that\nlost an anchor. These are PLAUSIBLE.\n\n**REFUTED** only when constructible from the code: factually wrong (quote the\nactual line); provably impossible (type/constant/invariant — show it); already\nhandled in this diff (cite the guard); or pure style with no observable effect."
const CLEANUP_PRECEDENCE = "Cleanup, altitude, and conventions candidates use the same\n`file`/`line`/`summary` shape; in `failure_scenario`, state the concrete\ncost (what is duplicated, wasted, harder to maintain, or which CLAUDE.md rule\nis broken) instead of a crash. Correctness bugs always outrank cleanup,\naltitude, and conventions findings when the output cap forces a cut.\n"
const SWEEP_GAP_FOCUS = "moved/extracted code that dropped a guard\nor anchor; second-tier footguns (dataclass default evaluated once, `hash()`\nnon-determinism, lock-scope shrink, predicate methods with side effects);\nsetup/teardown asymmetry in tests; config defaults flipped."

// ─── Schemas ───
const SCOPE_SCHEMA = {
  type: "object", required: ["diffCommand", "files", "summary"],
  properties: {
    diffCommand: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    claudeMdFiles: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    conventions: { type: "string" },
  },
}
const CANDIDATES_SCHEMA = {
  type: "object", required: ["candidates"],
  properties: {
    candidates: { type: "array", items: {
      type: "object", required: ["file", "summary", "failure_scenario"],
      properties: {
        file: { type: "string" },
        line: { type: "number" },
        summary: { type: "string" },
        failure_scenario: { type: "string" },
      },
    }},
  },
}
const VERDICT_SCHEMA = {
  type: "object", required: ["verdict", "evidence"],
  properties: {
    verdict: { enum: ["CONFIRMED", "PLAUSIBLE", "REFUTED"] },
    evidence: { type: "string" },
  },
}
const REPORT_SCHEMA = {
  type: "object", required: ["summary", "decisions"],
  properties: {
    summary: { type: "string" },
    decisions: { type: "array", items: {
      type: "object", required: ["index"],
      properties: {
        index: { type: "number", description: "the [i] label of a finding to keep in the report" },
        merge: { type: "array", items: { type: "number" }, description: "[i] labels of findings that describe the same root cause, folded into this one" },
      },
    }},
  },
}

// ─── Phase 0: Scope ───
phase("Scope")
const scope = await agent(
  "Establish the scope of a code review.\n\n" +
  (TARGET
    ? "Review target / instructions (passed by the user, verbatim): \"" + TARGET + "\". If it names a PR number, branch, ref range, or file path, build the matching git diff command for it; if it is a free-form instruction (e.g. only review certain files, focus on certain areas), honor any scope restriction when building the diff command and start from the current branch diff ('git diff @{upstream}...HEAD', falling back to 'git diff main...HEAD' or 'git diff HEAD~1') for whatever it does not narrow.\n"
    : "No explicit target — review the current branch: prefer 'git diff @{upstream}...HEAD' (fall back to 'git diff main...HEAD' or 'git diff HEAD~1'), and if there are uncommitted changes also include 'git diff HEAD'.\n") +
  "\n1. Determine the exact diff command(s) for the review and run them to confirm they produce a non-empty diff.\n" +
  "2. List the changed files.\n" +
  "3. Summarize what changed in one paragraph.\n" +
  "4. List the CLAUDE.md files that apply to the changed files (the user-level ~/.claude/CLAUDE.md, the repo-root CLAUDE.md, plus any CLAUDE.md or CLAUDE.local.md in a directory that is an ancestor of a changed file). Read each one that exists and note conventions a reviewer should know.\n\n" +
  "Return diffCommand exactly as a reviewer should run it. Structured output only.",
  { label: "scope", schema: SCOPE_SCHEMA }
)
if (!scope) {
  return { error: "Scope agent returned no result — cannot establish the review scope." }
}
if (!scope.files || scope.files.length === 0) {
  return { level: LEVEL, target: TARGET || undefined, summary: "No changes found to review.", findings: [], stats: { finders: 0, candidates: 0, verified: 0 } }
}
log(LEVEL + " review: " + scope.files.length + " changed files")

const claudeMdFiles = scope.claudeMdFiles || []
const SCOPE_BLOCK =
  "## Review scope\n" +
  "Diff command: " + scope.diffCommand + "\n" +
  "Changed files (" + scope.files.length + "):\n" +
  scope.files.map(f => "  - " + f).join("\n") + "\n" +
  "Applicable CLAUDE.md files (" + claudeMdFiles.length + "):\n" +
  (claudeMdFiles.length > 0 ? claudeMdFiles.map(f => "  - " + f).join("\n") : "  (none)") + "\n\n" +
  "## What changed\n" + scope.summary + "\n\n" +
  "## Conventions\n" + (scope.conventions || "(none noted)") + "\n" +
  // The user's verbatim target/instructions ride along to every finder,
  // verifier, and sweep agent so focus areas and skip requests are honored,
  // not just used for diff scoping.
  (TARGET
    ? "\n## User instructions (verbatim)\n" + TARGET + "\nHonor any scope restrictions or focus areas stated above — they take precedence over your angle's default breadth. Do not surface findings the instructions ask to skip.\n"
    : "") +
  FLAG_INSTRUCTIONS

// ─── Prompts ───
const FINDER_PROMPT = f =>
  "## Code-review finder — " + f.label + "\n\n" + SCOPE_BLOCK + "\n" +
  "Run the diff command above and review ONLY through the lens of your assigned angle:\n\n" +
  f.text + "\n" +
  (f.kind === "cleanup" ? CLEANUP_PRECEDENCE + "\n" : "") +
  "Surface up to " + P.perAngle + " candidate findings, each with file, line, a one-line summary, and a concrete failure_scenario — the user-visible consequence (error, wrong output, data loss), not an intermediate state (value stale, set grows). " +
  "Pass every candidate with a nameable failure scenario through — do not silently drop half-believed candidates; an independent verifier judges them next. " +
  "If nothing qualifies, return an empty list.\n\nStructured output only."

const VERIFIER_PROMPT = c =>
  "## Code-review verifier\n\n" + SCOPE_BLOCK + "\n" +
  "## Candidate finding\n" +
  "File: " + c.file + (c.line != null ? ":" + c.line : "") + "\n" +
  "Summary: " + c.summary + "\n" +
  "Failure scenario: " + c.failure_scenario + "\n\n" +
  "Run the diff command above, read the relevant file(s), and return exactly one verdict:\n\n" +
  VERDICT_LADDER + "\n\n" + VERDICT_LADDER_RECALL + "\n\n" +
  "Structured output only. Evidence must quote or cite the relevant line(s)."

// ─── No pre-verify dedup — every candidate gets a verifier; dedup happens once at synthesis ───
let candidatesSeen = 0

function verifyCandidate(c) {
  const short = (c.file || "").split("/").pop()
  return agent(VERIFIER_PROMPT(c), { label: "verify:" + short, phase: "Verify", schema: VERDICT_SCHEMA })
    .then(v => (v ? { ...c, verdict: v.verdict, evidence: v.evidence } : null))
}

// ─── Find → Verify, no barrier between finders ───
const FINDERS = CORRECTNESS_ANGLES.slice(0, P.correctnessAngles)
  .map(a => ({ ...a, kind: "correctness" }))
  .concat(CLEANUP_ANGLES.map(a => ({ ...a, kind: "cleanup" })))

const finderResults = await pipeline(
  FINDERS,

  f => agent(FINDER_PROMPT(f), { label: f.label, phase: "Find", schema: CANDIDATES_SCHEMA }).then(r => {
    if (!r) return { finder: f, candidates: [] }
    log(f.label + ": " + r.candidates.length + " candidates")
    return { finder: f, candidates: r.candidates.slice(0, P.perAngle) }
  }),

  result => {
    candidatesSeen += result.candidates.length
    return parallel(result.candidates.map(c => () => verifyCandidate({ ...c, kind: result.finder.kind })))
  }
)

let verified = finderResults.flat().filter(Boolean)

// ─── Sweep (xhigh/max): one fresh finder hunting only for gaps ───
if (P.sweep) {
  phase("Sweep")
  const knownBlock = verified.length > 0
    ? verified.map(c => "- " + c.file + (c.line != null ? ":" + c.line : "") + " — " + c.summary).join("\n")
    : "(none)"
  const sweep = await agent(
    "## Code-review sweep — gaps only\n\n" + SCOPE_BLOCK + "\n" +
    "## Already-found candidates (do NOT re-derive or re-confirm these)\n" + knownBlock + "\n\n" +
    "Re-read the diff and the enclosing functions looking ONLY for defects not already listed. " +
    "Focus on what the first pass tends to miss: " + SWEEP_GAP_FOCUS + "\n\n" +
    "Surface up to " + SWEEP_MAX + " additional candidates. If nothing new, return an empty list — do not pad.\n\nStructured output only.",
    { label: "sweep", phase: "Sweep", schema: CANDIDATES_SCHEMA }
  )
  if (sweep && sweep.candidates.length > 0) {
    const sliced = sweep.candidates.slice(0, SWEEP_MAX)
    candidatesSeen += sliced.length
    log("sweep: " + sliced.length + " candidates")
    const sweepVerified = await parallel(sliced.map(c => () => verifyCandidate({ ...c, kind: "correctness" })))
    verified = verified.concat(sweepVerified.filter(Boolean))
  }
}

const surviving = verified.filter(c => c.verdict !== "REFUTED")
const refuted = verified.filter(c => c.verdict === "REFUTED")
log("Verify done: " + verified.length + " verified → " + surviving.length + " kept, " + refuted.length + " refuted")

const stats = {
  level: LEVEL,
  finders: FINDERS.length,
  candidates: candidatesSeen,
  verified: verified.length,
  refuted: refuted.length,
}

if (surviving.length === 0) {
  return {
    level: LEVEL, target: TARGET || undefined,
    summary: "No findings survived verification.",
    findings: [],
    stats,
  }
}

// ─── Synthesize: rank, merge semantic dupes, cap ───
phase("Synthesize")
// Correctness bugs outrank cleanup findings when the cap forces a cut;
// CONFIRMED outranks PLAUSIBLE within each group.
const rank = c => (c.kind === "cleanup" ? 2 : 0) + (c.verdict === "PLAUSIBLE" ? 1 : 0)
const ranked = surviving.slice().sort((a, b) => rank(a) - rank(b))
const block = ranked.map((c, i) =>
  "### [" + i + "] " + c.file + (c.line != null ? ":" + c.line : "") + " (" + c.verdict + (c.kind === "cleanup" ? ", cleanup" : "") + ")\n" +
  c.summary + "\nFailure scenario: " + c.failure_scenario + "\nVerifier evidence: " + c.evidence + "\n"
).join("\n")

const report = await agent(
  "## Synthesis: final code-review report\n\n" +
  ranked.length + " findings survived independent verification (" + LEVEL + "-effort review). They are numbered [0]-[" + (ranked.length - 1) + "] below.\n\n" + block + "\n" +
  "## Instructions\n" +
  "Return decisions about findings BY INDEX — never re-emit finding text.\n" +
  "1. For each distinct defect, emit one decision with its index. When several findings describe the same defect (same root cause), keep one entry and list the others in its merge array.\n" +
  "2. Order decisions most-severe first. Correctness bugs always outrank cleanup findings.\n" +
  "3. Keep at most " + P.maxFindings + " decisions; omit the least severe beyond the cap.\n" +
  "4. Write a 2-3 sentence summary of the review.\n\nStructured output only.",
  { label: "synthesize", schema: REPORT_SCHEMA }
)

// Assembler invariants:
//   1. No silent drops while there is room: every verified finding either appears
//      (as primary or merge note) or is omitted only because the cap is full.
//   2. The displayed primary is the synthesizer's choice (d.index) — it picks the
//      best-described representative; we only escalate the verdict label when a
//      merged member is CONFIRMED.
//   3. The summary describes the report actually returned.
const decisions = report && Array.isArray(report.decisions) ? report.decisions : []
const valid = i => Number.isInteger(i) && i >= 0 && i < ranked.length
const loc = c => c.file + (c.line != null ? ":" + c.line : "")
const seen = new Set()
const claim = i => (valid(i) && !seen.has(i) ? (seen.add(i), true) : false)
const findings = []
for (const d of decisions) {
  if (findings.length >= P.maxFindings) break
  if (!claim(d.index)) continue
  const c = ranked[d.index]
  const merged = (Array.isArray(d.merge) ? d.merge : []).filter(claim).map(i => ranked[i])
  const verdict = merged.some(m => m.verdict === "CONFIRMED") ? "CONFIRMED" : c.verdict
  const also = merged.length > 0 ? " [same root cause also at: " + merged.map(loc).join(", ") + "]" : ""
  findings.push({ file: c.file, line: c.line, summary: c.summary + also, failure_scenario: c.failure_scenario, verdict })
}
const usedDecisions = findings.length > 0
let backfilled = 0
for (let i = 0; i < ranked.length && findings.length < P.maxFindings; i++) {
  if (seen.has(i)) continue
  const c = ranked[i]
  findings.push({ file: c.file, line: c.line, summary: c.summary, failure_scenario: c.failure_scenario, verdict: c.verdict })
  backfilled++
}
const summary = usedDecisions && report
  ? report.summary + (backfilled > 0 ? " (" + backfilled + " additional verified finding" + (backfilled === 1 ? "" : "s") + " appended unmerged.)" : "")
  : "Synthesis step was skipped or its decisions were unusable — returning verified findings ranked, unmerged."

return {
  level: LEVEL,
  target: TARGET || undefined,
  flags: { fix: FLAG_FIX, comment: FLAG_COMMENT },
  summary,
  findings,
  refuted: refuted.map(c => ({ file: c.file, line: c.line, summary: c.summary })),
  stats: { ...stats, reported: findings.length },
}
