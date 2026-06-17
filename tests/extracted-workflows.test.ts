import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("extracted workflow sources", () => {
  it("keeps deep-research resilient to failed searches and bounded fetches", async () => {
    const sourceText = await readFile(
      join(
        process.cwd(),
        ".claude/skills/deep-research/references/workflow-backed-deep-research.js"
      ),
      "utf8"
    );
    const sourceFile = ts.createSourceFile(
      "workflow-backed-deep-research.js",
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const ifStatements = collectIfStatements(sourceFile);

    const failedSearch = ifStatements.find(
      (statement) => statement.expression.getText(sourceFile) === "!r"
    );
    expect(failedSearch?.thenStatement.getText(sourceFile)).toContain(
      "return { angle: angle.label, results: [] }"
    );

    expect(sourceText).toContain("searchParams.delete(param)");
    expect(sourceText).toContain(".slice(0, MAX_FETCH)");
    expect(
      ifStatements.some((statement) =>
        statement.expression.getText(sourceFile).includes("fetchSlots <= 0 &&")
      )
    ).toBe(false);
  });

  it("parses workflow code-review flags outside the review target", async () => {
    const sourceText = await readFile(
      join(process.cwd(), ".claude/skills/code-review/references/workflow-backed-code-review.js"),
      "utf8"
    );
    expect(sourceText).toContain('token === "--fix"');
    expect(sourceText).toContain('token === "--comment"');
    expect(sourceText).toContain("POSITIONAL_ARGS");
    expect(sourceText).toContain("FLAG_INSTRUCTIONS");
  });
});

function collectIfStatements(node: ts.Node): ts.IfStatement[] {
  const out: ts.IfStatement[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isIfStatement(current)) {
      out.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return out;
}
