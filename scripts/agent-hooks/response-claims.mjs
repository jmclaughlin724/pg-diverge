import { currentTurnState } from "./state.mjs";

const verificationDomainLexicon = [
  ["guard", ["guard", "guards"]],
  ["test", ["test", "tests", "tested", "vitest"]],
  ["typecheck", ["typecheck", "typechecks"]],
  ["lint", ["lint", "lints"]],
  ["docs", ["docs", "documentation"]],
  ["build", ["build", "builds"]],
  ["package", ["package", "packages", "tarball"]],
  ["github-checks", ["checks", "check", "ci", "github"]],
  ["sync", ["sync", "synced"]],
  ["code-atlas", ["atlas"]],
];
const verificationDomainOfWord = new Map(
  verificationDomainLexicon.flatMap(([domain, words]) => words.map((word) => [word, domain]))
);
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
  "complete",
  "completes",
  "completed",
]);
const predicateBlockers = new Set([
  ...successPredicates,
  "fail",
  "fails",
  "failed",
  "failing",
  "error",
  "errors",
  "broken",
  "crash",
  "crashed",
  "red",
  "incomplete",
  "missing",
]);
const subjectBlockers = new Set([
  "it",
  "they",
  "them",
  "this",
  "that",
  "these",
  "those",
  "he",
  "she",
  "we",
  "i",
  "you",
  "which",
  "who",
  "what",
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

export function claimWithoutEvidence(message, state, transcript = []) {
  const claims = claimedVerificationDomains(message);
  if (claims.length === 0) {
    return;
  }
  const evidenceItems = [...currentTurnState(state).evidence, ...transcript];
  const contradicted = claims.filter((domain) => hasUnresolvedFailure(evidenceItems, domain));
  const missing = claims.filter((domain) => !hasSuccessfulEvidence(evidenceItems, domain));
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
    message: `The response claims verification while ${details.join("; ")}.`,
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
    if (!successPredicates.has(tokens[predicateIndex])) {
      continue;
    }
    const predicateClaims = new Set();
    for (let index = predicateIndex - 1; index >= 0; index -= 1) {
      const word = tokens[index];
      if (negationBlockers.has(word)) {
        predicateClaims.clear();
        break;
      }
      if (subjectBlockers.has(word) || predicateBlockers.has(word)) {
        break;
      }
      const domain = verificationDomainOfWord.get(word);
      if (domain) {
        predicateClaims.add(domain);
      }
    }
    for (const claim of predicateClaims) {
      claims.add(claim);
    }
  }
  return claims;
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
