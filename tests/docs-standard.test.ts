import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintDocsStandard } from "../scripts/check-docs-standard.mjs";

const roots: string[] = [];

const page = (body: string) => `---
title: "Test"
description: "A test page."
keywords: ["test", "docs"]
---

${body}
`;

async function writeDocs(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "supaschema-docs-standard-"));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    const absoluteFile = join(root, file);
    await mkdir(dirname(absoluteFile), { recursive: true });
    await writeFile(absoluteFile, contents);
  }
  return root;
}

const lintOne = async (file: string, contents: string) => {
  const root = await writeDocs({ [file]: contents });
  return lintDocsStandard({ rootDir: root, files: [file] });
};

describe("docs authoring standard", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("rejects relative markdown and MDX component docs links", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
[bare](commands/diff)
[dot](./setup)
[parent](../configuration/hints)
<Card title="Relative" icon="terminal" href="commands/types" />
`)
    );

    expect(violations).toHaveLength(4);
    expect(violations.map((violation) => violation.rule)).toEqual([
      "internal-link",
      "internal-link",
      "internal-link",
      "internal-link",
    ]);
    expect(violations.map((violation) => violation.msg).join("\n")).toContain(
      'link "commands/diff" - docs links must be root-relative'
    );
  });

  it("allows root-relative docs links, same-page links, mailto, and external links", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
[root](/commands/diff)
[fragment](/configuration/hints#object-keys)
[anchor](#local-heading)
[query](?playground=open)
[mail](mailto:docs@example.com)
[external](https://example.com/docs)
<Card title="Root" icon="terminal" href="/commands/types" />
`)
    );

    expect(violations).toEqual([]);
  });

  it("rejects absolute docs URLs, docs-directory paths, and markdown extensions", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
[absolute](https://supaschema.com/docs/commands)
[docs-dir](docs/configuration/hints)
[root-docs-dir](/docs/configuration/hints)
[extension](/configuration/hints.md)
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual([
      "internal-link",
      "internal-link",
      "internal-link",
      "internal-link",
    ]);
  });

  it("uses AST nodes for body headings and code fence metadata", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
\`\`\`md
# This is code, not a body heading.
\`\`\`

# Duplicate body heading

\`\`\`bash theme={null}
echo ok
\`\`\`
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual(["body-h1", "fence-artifact"]);
  });

  it("requires language tags on code fences", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
\`\`\`
plain output
\`\`\`
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual(["code-fence-language"]);
  });

  it("requires ParamField on command pages with Flags or Options sections", async () => {
    const missing = await lintOne(
      "docs/commands/example.mdx",
      page(`
## Flags

- \`--from\`
`)
    );
    const present = await lintOne(
      "docs/commands/example.mdx",
      page(`
## Options

<ParamField path="--from" type="source">
  Source.
</ParamField>
`)
    );

    expect(missing.map((violation) => violation.rule)).toEqual(["component"]);
    expect(present).toEqual([]);
  });

  it("validates docs.json navigation and allows hidden unlisted pages", async () => {
    const root = await writeDocs({
      "docs/docs.json": JSON.stringify({
        $schema: "https://mintlify.com/docs.json",
        theme: "luma",
        name: "supaschema",
        colors: { primary: "#1D4ED8" },
        icons: { library: "lucide" },
        contextual: {
          options: ["copy", "view", "chatgpt", "claude", "mcp", "add-mcp", "cursor", "vscode"],
        },
        navigation: { groups: [{ group: "Start", pages: ["page"] }] },
      }),
      "docs/page.mdx": page("## Start"),
      "docs/hidden.mdx": `---
title: "Hidden"
description: "Hidden page."
keywords: ["hidden", "docs"]
hidden: true
---

## Hidden
`,
    });

    const violations = lintDocsStandard({
      rootDir: root,
      files: ["docs/page.mdx", "docs/hidden.mdx"],
    });

    expect(violations).toEqual([]);
  });

  it("requires keywords and rejects unsupported frontmatter values", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      `---
title: "Test"
description: "A test page."
keywords: []
hidden: false
mode: "unsupported"
noindex: "no"
---

## Start
`
    );

    expect(violations.map((violation) => violation.rule)).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "frontmatter",
    ]);
    expect(violations.map((violation) => violation.msg).join("\n")).toContain(
      "missing or invalid `keywords` array"
    );
    expect(violations.map((violation) => violation.msg).join("\n")).toContain(
      "`hidden` must be true when present"
    );
  });

  it("rejects generic link text", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
[here](/commands/diff)
[Descriptive command reference](/commands/diff)
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual(["link-text"]);
  });

  it("requires docs images to live under /images and use Frame", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
![Example diagram](/diagrams/example.svg)

<img src="/images/example.svg" alt="Example diagram" />
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual([
      "image-path",
      "image-frame",
      "image-frame",
    ]);
  });

  it("allows framed docs images under /images", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
<Frame caption="Example diagram">
  <img src="/images/example.svg" alt="Example diagram" />
</Frame>
`)
    );

    expect(violations).toEqual([]);
  });

  it("rejects Columns card grids and malformed cards", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
<Columns cols={2}>
  <Card title="Missing icon" href="/commands/diff">
    Read the command reference.
  </Card>
</Columns>

<Card icon="terminal" href="/commands/check">
  Missing title.
</Card>
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual(["card-grid", "card", "card"]);
    expect(violations.map((violation) => violation.msg).join("\n")).toContain(
      "use <CardGroup> for docs card grids"
    );
  });

  it("limits CardGroup size by column count", async () => {
    const twoColumn = await lintOne(
      "docs/page.mdx",
      page(`
<CardGroup cols={2}>
  <Card title="One" icon="circle">One.</Card>
  <Card title="Two" icon="circle">Two.</Card>
  <Card title="Three" icon="circle">Three.</Card>
  <Card title="Four" icon="circle">Four.</Card>
  <Card title="Five" icon="circle">Five.</Card>
</CardGroup>
`)
    );
    const threeColumn = await lintOne(
      "docs/page.mdx",
      page(`
<CardGroup cols={3}>
  <Card title="One" icon="circle">One.</Card>
  <Card title="Two" icon="circle">Two.</Card>
</CardGroup>
`)
    );

    expect(twoColumn.map((violation) => violation.rule)).toEqual(["card-grid"]);
    expect(threeColumn.map((violation) => violation.rule)).toEqual(["card-grid"]);
  });

  it("rejects long card bodies", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
<Card title="Long" icon="book">
  This card body is deliberately much too long because cards should be glanceable, not miniature documentation sections with multiple clauses, several details, extra context, repeated caveats, and explanation that belongs in the page body instead of inside a compact card.
</Card>
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual(["card"]);
    expect(violations[0]?.msg).toContain("35 words max");
  });

  it("rejects adjacent callouts without explanatory content", async () => {
    const violations = await lintOne(
      "docs/page.mdx",
      page(`
<Note>First note.</Note>
<Tip>Second tip.</Tip>
`)
    );

    expect(violations.map((violation) => violation.rule)).toEqual(["callout-spacing"]);
  });

  it("requires sentence-case body headings while allowing commands, acronyms, and code", async () => {
    const rejected = await lintOne(
      "docs/page.mdx",
      page(`
## How It Works
`)
    );
    const allowed = await lintOne(
      "docs/page.mdx",
      page(`
## diff

## CI

## \`dir:\` files

## GitHub Actions
`)
    );

    expect(rejected.map((violation) => violation.rule)).toEqual(["heading-case"]);
    expect(allowed).toEqual([]);
  });

  it("rejects invalid docs.json config and orphan navigation pages", async () => {
    const root = await writeDocs({
      "docs/docs.json": JSON.stringify({
        $schema: "https://example.com/schema.json",
        theme: "unknown",
        name: "",
        colors: { primary: "blue" },
        icons: { library: "tabler" },
        navigation: {
          groups: [
            {
              group: "This navigation label is too long for a compact sidebar item",
              pages: ["missing.md"],
            },
          ],
        },
      }),
      "docs/page.mdx": page("## Start"),
    });

    const violations = lintDocsStandard({ rootDir: root, files: ["docs/page.mdx"] });
    const rules = violations.map((violation) => violation.rule);

    expect(rules).toContain("docs-json");
    expect(rules).toContain("navigation");
    expect(rules).toContain("navigation-label");
    expect(violations.map((violation) => violation.msg).join("\n")).toContain(
      "missing from docs.json"
    );
  });
});
