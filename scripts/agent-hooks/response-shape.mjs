import { failureLabels, transcriptEvidence, unresolvedFailures } from "./command-evidence.mjs";
import { tokenize, verificationClaimConflict } from "./response-claims.mjs";
import { finalMessage, lower } from "./response-evidence.mjs";
import { currentTurnState, setCorrections } from "./state.mjs";

const hedgeWords = ["maybe", "probably", "possibly", "likely", "might", "seems"];
const menuTerms = ["option 1", "option a", "choose", "which approach", "pick one"];
const directTerms = ["execute", "implement", "fix", "update", "do it", "make the change"];
const toolIncidentLead = "tool incident:";
const toolIncidentAttemptTerms = ["attempt", "tried"];
const toolIncidentImpactTerms = ["mutation", "impact"];
const toolIncidentRecoveryTerms = ["recover", "rerun", "retry", "resolved", "safely"];

export function runResponseDetectors(payload, state, runtime) {
  const message = finalMessage(payload);
  const findings = [
    materialToolIncidentDisclosure(message, state),
    hedgeDensity(message),
    verificationClaimConflict(message, state, transcriptEvidence(payload), runtime),
    decisionMenuAfterDirective(message, state),
    toolFailureWithoutRetry(state),
  ].filter(Boolean);

  const pendingFindings = setCorrections(payload, state, findings).filter(
    (finding) => !finding.blocked
  );
  if (pendingFindings.length === 0) {
    return {};
  }
  return {
    contextParts: [
      [
        "Final response correction required.",
        ...pendingFindings.map((finding) => `- ${finding.message}`),
        "Revise the response using only verified evidence already present in the session. To resolve any assumptions or lack of clarity, query context7 or upstream sources prior to continuing.",
      ].join("\n"),
    ],
  };
}

export function materialToolIncidentDisclosure(message, state) {
  const incidentRecorded = currentTurnState(state).evidence.some(
    (item) =>
      item?.kind === "tool-incident" &&
      item?.incident === "shell-command-not-found" &&
      item?.outcome === "failure"
  );
  if (!incidentRecorded) {
    return;
  }
  const response = lower(message.trimStart());
  const hasLead = response.startsWith(toolIncidentLead) && response.includes("command not found");
  const namesAttempt = toolIncidentAttemptTerms.some((term) => response.includes(term));
  const hasImpact = toolIncidentImpactTerms.some((term) => response.includes(term));
  const hasRecovery = toolIncidentRecoveryTerms.some((term) => response.includes(term));
  if (hasLead && namesAttempt && hasImpact && hasRecovery) {
    return;
  }
  return {
    id: "material-tool-incident-not-leading",
    message:
      "A shell command-not-found incident was recorded. Begin the final response with `Tool incident:`, explicitly say `command not found`, state what the shell attempted, and give mutation/impact and recovery evidence before the outcome. A successful retry does not make the incident optional or a read-only-search caveat.",
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
