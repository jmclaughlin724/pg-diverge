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

    expect(
      ifStatements.some(
        (statement) => statement.expression.getText(sourceFile) === "fetchSlots <= 0"
      )
    ).toBe(true);
    expect(
      ifStatements.some((statement) =>
        statement.expression.getText(sourceFile).includes("fetchSlots <= 0 &&")
      )
    ).toBe(false);
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
