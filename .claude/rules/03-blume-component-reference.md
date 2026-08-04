---
description: Blume component selection policy and syntax guardrails.
paths:
  - "docs/**"
---

# Rule 03 - Blume component reference

## Contract

This rule owns Blume component selection guardrails for `docs/**`. It is a concise policy reference; the full catalog lives in the Blume component docs.

Sources:

- Blume components: <https://useblume.dev/docs/content/components>
- Blume syntax: <https://useblume.dev/docs/content/syntax>

## Component selection

| Need | Component |
| --- | --- |
| Note, tip, success, warning, danger, or info aside | `:::type` callout directive |
| Sequential complex procedure | `<Steps>` / `<Step>` |
| Platform or language alternatives | `<Tabs>` / `<Tab>` |
| Same concept in multiple languages | `<CodeGroup>` |
| Navigation or related resources | `<Card>` inside `<CardGroup>` |
| Non-card layout grid | `<Columns>` / `<Column>` |
| Titled supplementary container | `<Panel>` |
| Collapsible detail | `<Expandable>` or `<Accordion>` |
| Images and diagrams | `<Frame>` |
| Directory or file tree | `<FileTree>` or `<Tree>` |
| Property or type documentation | `<TypeTable>` / `<AutoTypeTable>` |
| Before-and-after code change | `<Diff>` |
| Copyable agent prompt | `<Prompt>` |
| Small inline status label | `<Badge>` |
| Simple generated diagram | fenced `mermaid` block |

## Syntax rules

- Callouts use `:::type` directives with types `note`, `tip`, `success`, `warning`, `danger`, and `info`, plus an optional `[Title]`. Directives are MDX-only.
- Do not stack callouts without intervening explanatory content.
- `<Note>`, `<Tip>`, `<Info>`, `<Warning>`, `<Danger>`, `<ParamField>`, `<ResponseField>`, `<RequestExample>`, and `<ResponseExample>` are not Blume components. `blume build` fails on unknown components, so do not reintroduce them.
- Document CLI flags and arguments with a `Name | Type | Description` Markdown table. Escape a literal `|` inside a cell as `\|`. Reserve `<TypeTable>` for API or type reference.
- Use `<Steps>` for procedures with subtasks or verification. Use ordered lists for short, simple steps.
- Use `<Tabs>` only when alternatives are genuinely parallel and the user chooses one path.
- Use `<CodeGroup>` only when examples express the same concept in multiple languages.
- Use `<CardGroup>` as the repo-standard card grid with its default two columns. Reserve `<Columns>` for non-card layout.
- Every `<Card>` has a short `title`, an `icon`, and one short body sentence. Internal card links use extensionless root-relative `href` values.
- Keep card grids small: at most four cards per grid. Split larger choice sets into smaller grids with clear section headings.
- Wrap docs images and diagrams in `<Frame>`, use a `caption` when context helps, and keep descriptive alt text on the image itself.
- Use root-relative image paths beginning with `/images/`.
- Use `<Prompt>` only when the prompt itself is a reusable docs artifact users should copy.

## Code example rules

- Use complete, runnable examples when the user is expected to copy them.
- Show realistic values without real secrets.
- Include expected output or verification when the example changes state.
- Include error handling when the example touches network, files, credentials, databases, or external APIs.
- Specify the code-fence language, and add a filename title when useful. Use Blume's `{1,4-5}` ranges or `[!code highlight]` markers for load-bearing lines.
- Use `text` for terminal output and other plain output.

## API docs rules

- Prefer OpenAPI/AsyncAPI specs for endpoint references; Blume renders them as interactive references through Scalar.
- Manual API docs must show request and response examples, all required fields, authentication format, status and error behavior, and pagination or rate-limit behavior when applicable.
- API docs that include a route contract must stay aligned with the generated public contract owner.

## Accessibility rules

- Images require descriptive alt text.
- Links use specific actionable text, not "click here".
- Heading hierarchy starts with H2 inside the page body.
- Component usage must support scanning and keyboard navigation.

## Verification

When component syntax changes or a docs page uses these components, run:

```bash
npm run docs:check
```

## Failure behavior

Convert unknown components to their Blume equivalents at the source page. Do not register compatibility shims through `components.ts` to avoid conversion, and do not flatten component-rich content into plain Markdown to dodge a syntax error.

## Done means

The selected component exists in Blume, matches the reader need, passes `blume doctor` and `blume validate`, and remains accessible.
