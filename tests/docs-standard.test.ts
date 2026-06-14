import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintDocsStandard } from "../scripts/check-docs-standard.mjs";

const roots: string[] = [];

const page = (body: string) => `---
title: "Test"
description: "A test page."
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
<Card title="Relative" href="commands/types" />
`),
    );

    expect(violations).toHaveLength(4);
    expect(violations.map((violation) => violation.rule)).toEqual([
      "internal-link",
      "internal-link",
      "internal-link",
      "internal-link",
    ]);
    expect(violations.map((violation) => violation.msg).join("\n")).toContain(
      'link "commands/diff" - docs links must be root-relative',
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
<Card title="Root" href="/commands/types" />
`),
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
`),
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
`),
    );

    expect(violations.map((violation) => violation.rule)).toEqual(["body-h1", "fence-artifact"]);
  });

  it("requires ParamField on command pages with Flags or Options sections", async () => {
    const missing = await lintOne(
      "docs/commands/example.mdx",
      page(`
## Flags

- \`--from\`
`),
    );
    const present = await lintOne(
      "docs/commands/example.mdx",
      page(`
## Options

<ParamField path="--from" type="source">
  Source.
</ParamField>
`),
    );

    expect(missing.map((violation) => violation.rule)).toEqual(["component"]);
    expect(present).toEqual([]);
  });
});
