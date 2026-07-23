import { currentTurnState } from "./state.mjs";

const verificationDomainLexicon = [
  ["guard", ["guard", "guards"]],
  ["test", ["test", "tests", "tested", "vitest"]],
  ["typecheck", ["typecheck", "typechecks"]],
  ["lint", ["lint", "lints"]],
  ["docs", ["docs", "documentation"]],
  ["build", ["build", "builds"]],
  ["package", ["package", "packages", "tarball"]],
  ["github-checks", ["ci", "github"]],
  ["sync", ["sync", "synced"]],
  ["code-atlas", ["atlas"]],
];
const verificationDomainOfWord = new Map(
  verificationDomainLexicon.flatMap(([domain, words]) => words.map((word) => [word, domain]))
);
const compoundDomainOfTail = new Map([
  ["suite", "test"],
  ["suites", "test"],
  ["run", "test"],
  ["runs", "test"],
  ["command", "guard"],
  ["commands", "guard"],
  ["step", "typecheck"],
  ["steps", "typecheck"],
  ["task", "lint"],
  ["tasks", "lint"],
  ["job", "build"],
  ["jobs", "build"],
]);
const verificationCheckTails = new Set(["check", "checks"]);
const successPredicates = new Set([
  "pass",
  "passes",
  "passed",
  "passing",
  "green",
  "verify",
  "verifies",
  "verified",
  "tested",
  "succeed",
  "succeeds",
  "succeeded",
  "success",
  "successful",
]);
const claimJoiners = new Set([
  "a",
  "all",
  "already",
  "an",
  "are",
  "be",
  "been",
  "being",
  "both",
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "is",
  "now",
  "successfully",
  "the",
  "was",
  "were",
]);
const coordinationJoiners = new Set(["and", "or"]);
const associationBoundaries = new Set([
  "about",
  "analysing",
  "analyzing",
  "around",
  "concerning",
  "covering",
  "describing",
  "discussing",
  "examining",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "by",
  "from",
  "into",
  "than",
  "at",
  "as",
  "mentioning",
  "regarding",
  "reviewing",
  "studying",
]);
const negationBlockers = new Set([
  "not",
  "never",
  "no",
  "neither",
  "nor",
  "n't",
  "cannot",
  "can't",
  "won't",
  "didn't",
  "doesn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "without",
]);
const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

export function tokenize(text) {
  const words = [];
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (isWordLike) {
      words.push(segment.toLowerCase());
    }
  }
  return words;
}

export function claimedVerificationDomains(message) {
  const claims = new Set();
  for (const clause of splitClauses(message)) {
    for (const domain of clauseDomainClaims(clause)) {
      claims.add(domain);
    }
  }
  return [...claims];
}

export function verificationClaimConflict(message, state, transcript, runtime) {
  const claims = claimedVerificationDomains(message);
  if (claims.length === 0) {
    return;
  }
  const evidenceItems = [...currentTurnState(state).evidence, ...transcript];
  const contradicted = claims.filter((domain) => hasUnresolvedFailure(evidenceItems, domain));
  const missing =
    runtime === "codex"
      ? []
      : claims.filter((domain) => !hasSuccessfulEvidence(evidenceItems, domain));
  if (contradicted.length === 0 && missing.length === 0) {
    return;
  }
  const details = [
    contradicted.length > 0
      ? `failed evidence remains unresolved for: ${contradicted.join(", ")}`
      : undefined,
    missing.length > 0
      ? `no successful evidence was recorded for: ${missing.join(", ")}`
      : undefined,
  ].filter((item) => item !== undefined);
  return {
    id: "claim-without-evidence",
    message: `The response claims verification while ${details.join("; ")}. Provide matching command evidence, remove the verification claim, or state that verification was not run.`,
  };
}

const clauseBoundaryChars = new Set([".", ",", "\n", ";", "|", "!", "?", "•", ":", "-"]);

function splitClauses(text) {
  const clauses = [];
  let current = "";
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (isWordLike) {
      current += segment;
      continue;
    }
    if (clauseBoundaryChars.has(segment)) {
      if (current.trim()) {
        clauses.push(current.trim());
      }
      current = "";
    } else {
      current += segment;
    }
  }
  if (current.trim()) {
    clauses.push(current.trim());
  }
  return clauses;
}

function clauseDomainClaims(clause) {
  const tokens = tokenize(clause);
  const claims = new Set();
  for (let predicateIndex = 0; predicateIndex < tokens.length; predicateIndex += 1) {
    const scanStart = claimScanStart(tokens, predicateIndex);
    if (scanStart === undefined) {
      continue;
    }
    for (const claim of scanPredicateClaims(tokens, scanStart)) {
      claims.add(claim);
    }
  }
  return [...claims];
}

function scanPredicateClaims(tokens, scanStart) {
  const claims = new Set();
  let coordinated = false;
  let sawDomain = false;
  for (let index = scanStart; index >= 0; index -= 1) {
    const word = tokens[index];
    if (negationBlockers.has(word)) {
      claims.clear();
      break;
    }
    const match = verificationDomainMatch(tokens, index);
    if (match) {
      if (!sawDomain || coordinated) {
        claims.add(match.domain);
      }
      coordinated = false;
      sawDomain = true;
      index -= match.width - 1;
      continue;
    }
    if (coordinationJoiners.has(word) && sawDomain) {
      coordinated = true;
      continue;
    }
    if (claimJoiners.has(word)) {
      continue;
    }
    if (associationBoundaries.has(word)) {
      claims.clear();
      coordinated = false;
      sawDomain = false;
      continue;
    }
    if (sawDomain && hasEarlierAssociationBoundary(tokens, index)) {
      claims.clear();
    }
    break;
  }
  return claims;
}

function verificationDomainMatch(tokens, index) {
  const compoundDomain = compoundVerificationDomain(tokens, index);
  if (compoundDomain) {
    return { domain: compoundDomain, width: 2 };
  }
  const domain = verificationDomainOfWord.get(tokens[index]);
  return domain ? { domain, width: 1 } : undefined;
}

function claimScanStart(tokens, predicateIndex) {
  if (successPredicates.has(tokens[predicateIndex])) {
    return predicateIndex - 1;
  }
  return tokens[predicateIndex] === "successfully" && tokens[predicateIndex - 1] === "completed"
    ? predicateIndex - 2
    : undefined;
}

function compoundVerificationDomain(tokens, tailIndex) {
  const tail = tokens[tailIndex];
  if (verificationCheckTails.has(tail)) {
    const headIndex = tokens[tailIndex - 1] === "status" ? tailIndex - 2 : tailIndex - 1;
    return verificationDomainOfWord.get(tokens[headIndex]);
  }
  const domain = compoundDomainOfTail.get(tail);
  if (!domain) {
    return;
  }
  return verificationDomainOfWord.get(tokens[tailIndex - 1]) === domain ? domain : undefined;
}

function hasEarlierAssociationBoundary(tokens, throughIndex) {
  return tokens.slice(0, throughIndex + 1).some((word) => associationBoundaries.has(word));
}

function hasUnresolvedFailure(evidence, domain) {
  return evidence.some(
    (failure) =>
      isFailureEvidence(failure) &&
      domainsOf(failure).includes(domain) &&
      !evidence.some(
        (item) =>
          isSuccessEvidence(item) &&
          domainsOf(item).includes(domain) &&
          item.at &&
          failure.at &&
          item.at > failure.at
      )
  );
}

function hasSuccessfulEvidence(evidence, domain) {
  return evidence.some((item) => {
    if (domain === "code-atlas" && item.kind === "code-atlas-query" && item.outcome !== "failure") {
      return true;
    }
    return isSuccessEvidence(item) && domainsOf(item).includes(domain);
  });
}

function isSuccessEvidence(item) {
  return (
    (item.kind === "verified-command" || item.kind === "successful-command") &&
    item.outcome !== "failure"
  );
}

function isFailureEvidence(item) {
  return item.kind === "failed-command" && item.outcome === "failure";
}

function domainsOf(item) {
  return Array.isArray(item?.domains)
    ? item.domains.filter((domain) => typeof domain === "string")
    : [];
}
