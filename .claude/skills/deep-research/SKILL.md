---
name: deep-research
description: Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report. Use when the user wants a deep, multi-source, fact-checked research report on a specific question.
user-invocable: true
argument-hint: "<research question>"
---

## Contract

Run the extracted Claude Code `deep-research` workflow for deep, multi-source, fact-checked research. The complete bundled workflow implementation is preserved in `references/workflow-backed-deep-research.js`.

This local skill is a filesystem wrapper around the bundled workflow payload. It preserves the embedded workflow source separately so the extraction can be verified against the binary without rewriting the prompt.

## When To Use

When the user wants a deep, multi-source, fact-checked research report on any topic. BEFORE invoking, check if the question is specific enough to research directly — if underspecified (e.g., "what car to buy" without budget/use-case/region), ask 2-3 clarifying questions to narrow scope. Then pass the refined question as args, weaving the answers in.

## Dispatch

1. Confirm the research question is specific enough to research directly.
2. If the request is underspecified, ask 2-3 clarifying questions before running the workflow.
3. Pass the refined question as the workflow argument.
4. Read `references/workflow-backed-deep-research.js` completely before executing or adapting the workflow.
5. Follow the workflow phases: Scope, Search, Fetch, Verify, Synthesize.

## Workflow Metadata

- Scope: Decompose question (from args) into 5 search angles
- Search: 5 parallel WebSearch agents, one per angle
- Fetch: URL-dedup, fetch top 15 sources, extract falsifiable claims
- Verify: 3-vote adversarial verification per claim (need 2/3 refutes to kill)
- Synthesize: Merge semantic dupes, rank by confidence, cite sources

## Reference Index

- `references/workflow-backed-deep-research.js`: exact bundled workflow source extracted from the Claude Code binary.

## Verification

Extraction is valid when `references/workflow-backed-deep-research.js` matches the decoded binary payload and the repo agent-surface sync checks pass.
