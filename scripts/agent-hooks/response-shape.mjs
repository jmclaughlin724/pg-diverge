import { failureLabels, transcriptEvidence, unresolvedFailures } from "./command-evidence.mjs";
import { claimWithoutEvidence, tokenize } from "./response-claims.mjs";
import { finalMessage, lower } from "./response-evidence.mjs";
import { currentTurnState, setCorrections } from "./state.mjs";

const completionWords = ["completed", "finished", "done", "implemented", "fixed"];
const hedgeWords = ["maybe", "probably", "possibly", "likely", "might", "could", "seems"];
const deferralTerms = ["if you want", "would you like", "i can ", "i could ", "let me know"];
const menuTerms = ["option 1", "option a", "choose", "which approach", "pick one"];
const directTerms = ["execute", "implement", "fix", "update", "do it", "make the change"];
const userDecisionTerms = [
  "approval",
  "approve",
  "authorization",
  "permission",
  "product scope",
  "secret",
  "credentials",
  "external",
  "destructive",
  "irreversible",
  "cost",
  "spend",
];
const blockerDispositionTerms = [
  "blocked",
  "blocker",
  "requires",
  "needs",
  "cannot proceed",
  "can't proceed",
  "cannot continue",
  "can't continue",
];
const diagnosticPromptTerms = [
  "why",
  "verify",
  "source",
  "correct",
  "expected",
  "supposed to",
  "redundant",
  "best practice",
  "upstream",
  "review",
  "architecture",
  "design",
  "working correctly",
  "enforce",
  "logic chain",
];
const mechanismClaimTerms = [
  "as designed",
  "documented",
  "expected",
  "correct",
  "running correctly",
  "supposed to be",
  "upstream says",
  "valid behavior",
  "working correctly",
];
const architectureDispositionTerms = [
  "$elegant",
  "architecture",
  "canonical",
  "end state",
  "entry point",
  "local design",
  "owner",
  "topology",
];
const verificationDispositionTerms = [
  "checked",
  "command",
  "evidence",
  "failed",
  "guard",
  "not run",
  "passed",
  "skipped",
  "source",
  "test",
  "verified",
];

export function runResponseDetectors(payload, state) {
  const message = finalMessage(payload);
  const findings = [
    hedgeDensity(message),
    completionClaimWithOpenItems(message, payload, state),
    claimWithoutEvidence(message, state, transcriptEvidence(payload)),
    mechanismClaimWithoutArchitecture(message, state),
    decisionMenuAfterDirective(message, state),
    deferralLanguage(message),
    toolFailureWithoutRetry(state),
  ].filter(Boolean);

  setCorrections(state, findings);
  if (findings.length === 0) {
    return {};
  }
  return {
    contextParts: [
      [
        "Final response correction required.",
        ...findings.map((finding) => `- ${finding.message}`),
        "Revise the response using only verified evidence already present in the session. To resolve any assumptions or lack of clarity, query context7 or /upstream sources prior to continuing.",
      ].join("\n"),
    ],
  };
}

export function hedgeDensity(message) {
  const words = tokenize(message);
  if (words.length < 10) {
    return;
  }
  const count = hedgeWords.reduce((total, term) => total + countTerm(message, term), 0);
  return count >= 3
    ? {
        id: "hedge-density",
        message:
          "The final response uses dense hedging; replace uncertainty with verified facts or explicit unknowns.",
      }
    : undefined;
}

export function completionClaimWithOpenItems(message, payload, state) {
  const hasCompletion = completionWords.some((term) => lower(message).includes(term));
  const openTasks = Array.isArray(payload?.background_tasks) && payload.background_tasks.length > 0;
  const pendingSkills = Object.keys(currentTurnState(state).pendingSkills).some(
    (skill) => !state.invokedSkills[skill]
  );
  return hasCompletion && (openTasks || pendingSkills)
    ? {
        id: "completion-claim-with-open-items",
        message:
          "The response claims completion while open background tasks or pending skills remain.",
      }
    : undefined;
}

export function mechanismClaimWithoutArchitecture(message, state) {
  const response = lower(message);
  const turn = currentTurnState(state);
  const prompt = lower(turn.lastPrompt);
  const diagnosticPrompt = diagnosticPromptTerms.some((term) => prompt.includes(term));
  const mechanismClaim = mechanismClaimTerms.some((term) => response.includes(term));
  if (!(diagnosticPrompt && mechanismClaim)) {
    return;
  }
  const hasArchitectureDisposition = architectureDispositionTerms.some((term) =>
    response.includes(term)
  );
  const hasVerificationDisposition = verificationDispositionTerms.some((term) =>
    response.includes(term)
  );
  if (hasArchitectureDisposition && hasVerificationDisposition) {
    return;
  }
  const missing = [];
  if (!hasArchitectureDisposition) {
    missing.push("architecture/end-state disposition");
  }
  if (!hasVerificationDisposition) {
    missing.push("verification disposition");
  }
  return {
    id: "mechanism-claim-without-architecture",
    message: `The response handles mechanism or correctness without ${missing.join(" and ")}.`,
  };
}

export function decisionMenuAfterDirective(message, state) {
  const direct = directTerms.some((term) =>
    lower(currentTurnState(state).lastPrompt).includes(term)
  );
  const menu = menuTerms.some((term) => lower(message).includes(term));
  return direct && menu
    ? {
        id: "decision-menu-after-directive",
        message: "The response offered a decision menu after a direct implementation directive.",
      }
    : undefined;
}

export function deferralLanguage(message) {
  const response = lower(message);
  return deferralTerms.some((term) => response.includes(term)) &&
    !isUserOwnedDecisionDisposition(response)
    ? {
        id: "deferral-language",
        message: "The response defers work instead of reporting concrete action or a blocker.",
      }
    : undefined;
}

function isUserOwnedDecisionDisposition(response) {
  return (
    userDecisionTerms.some((term) => response.includes(term)) &&
    blockerDispositionTerms.some((term) => response.includes(term))
  );
}

export function toolFailureWithoutRetry(state) {
  const evidence = currentTurnState(state).evidence;
  const unresolved = unresolvedFailures(evidence);
  if (unresolved.length === 0) {
    return;
  }
  return {
    id: "tool-failure-without-retry",
    message: `A verification command failed and no later successful verification evidence for the same command or domain is recorded: ${failureLabels(unresolved).join(", ")}.`,
  };
}

function countTerm(message, term) {
  return lower(message).split(term).length - 1;
}
