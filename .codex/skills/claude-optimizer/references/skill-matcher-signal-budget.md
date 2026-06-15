# Skill Matcher Signal Budget

When authoring or consolidating a skill, the merged total of `metadata.keywords`, `metadata.intent-patterns`, `metadata.file-triggers`, and the implicit skill-name keyword forms a fixed `totalSignals` count. Per-prompt hits are divided by `totalSignals` to form the confidence percentage the matcher gates on. Inflated signal counts dilute single-hit prompts below the threshold even when an intent regex fires correctly.

## Threshold contract

`scripts/llm-sync` defaults inherited by `.claude/hooks/skill-matcher/skill-matcher.ts`:

| Setting | Value | Effect |
| --- | --- | --- |
| `MIN_CONFIDENCE` (default) | 0.10 | Minimum `hits / totalSignals` for skills without the discount |
| `MIN_CONFIDENCE_LOW` | 0.03 | Minimum for skills with `metadata.skipMetaAnalysisDiscount` |
| `threshold` (default) | 50% | Required share of the top-scoring skill's hit count |
| `thresholdLow` | 20% | Required share with the discount |
| File-trigger contribution | +2 | A matched glob doubles its weight in `hits` |
| File-trigger `totalSignals` cost | +1 | Each glob still adds one to the denominator |

Single-hit prompts (one keyword OR one intent-pattern fires) require:

```
hits / totalSignals >= 0.03
=> totalSignals <= 33
```

Cross the boundary and the prompt drops out silently — the matcher returns `pending-skills: []` even though the regex matched, with no diagnostic.

## Authoring rule of thumb

Keep `totalSignals <= 30` for any skill that expects single-hit prompts to fire it. Combined budget across `keywords + intent-patterns + file-triggers + skill-name`:

| Surface area    | Recommended cap |
| --------------- | --------------- |
| keywords        | ≤ 12            |
| intent-patterns | ≤ 14            |
| file-triggers   | ≤ 5             |
| skill name      | 1 (auto-added)  |

Prefer intent-pattern regex over per-phrase keyword variants — `(?:trace|find)\s+(?:where\s+)?(?:this\s+|the\s+)?(?:error|bug|failure|exception)` is one signal that covers six redundant keyword phrases.

## When consolidating multiple skills

Naive union of N skills' frontmatter routinely produces 100+ totalSignals. Symptom: keyword/intent matches verifiably exist but the matcher returns empty pending-skills. Fix by collapsing redundant keywords into intent regexes and dropping descriptive nouns ("knowledge graph", "call graph", "code intelligence") that do not anchor a unique semantic surface.

## Verifying the budget

After authoring, run a probe per-prompt that should match:

```sh
SID=test-$$
echo '{"hook_event_name":"UserPromptSubmit","prompt":"<probe>","session_id":"'$SID'"}' \
  | bun .claude/hooks/skill-matcher/skill-matcher.ts prompt
cat .claude/state/sessions/$SID/pending-skills
rm -rf .claude/state/sessions/$SID
```

`{"skills":[]}` with intent matches in the prompt = signal-budget overrun. Check `totalSignals = keywords.length + intent-patterns.length + file-triggers.length + 1` and trim until 1 / totalSignals >= 0.034 with margin.

For consolidated skills, write a focused verifier script that probes every retired skill's canonical prompt and asserts the new consolidated skill matches each.

## Common authoring pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Verifier probes pass the keyword check but `pending-skills` is empty | `totalSignals` over the dilution threshold | Trim redundant keywords; rely on intent-pattern coverage |
| File-trigger probes fire but prompt probes do not | Globs add to `totalSignals` while not firing on prompts | Reduce keywords/intent-patterns to compensate; file-triggers contribute +2 weight |
| Adding a synonym keyword reduces match rate | New keyword raises denominator without firing | Replace with intent-pattern regex covering the synonym |

## Related

- `.claude/hooks/skill-matcher/skill-matcher.ts` — `scoreSkill()` (line 423), `selectTopMatches()` (line ~917), `MIN_CONFIDENCE_LOW` constant
- `.claude/skills/claude-optimizer/references/skill-frontmatter-schema.md` — full frontmatter contract
- `.claude/skills/claude-optimizer/references/skill-matcher-patterns.md` — matcher behavior reference
