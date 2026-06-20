import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("CI governance guard", () => {
  it("scans cached workflow files only", () => {
    const source = ts.createSourceFile(
      "check-ci-governance.mjs",
      readFileSync(resolve("scripts/guards/check-ci-governance.mjs"), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const args = gitWorkflowLsFilesArgs(source);

    expect(args).toHaveLength(5);
    expect(args).toContain("--cached");
    expect(args).not.toContain("--others");
    expect(args).not.toContain("--exclude-standard");
  });

  it("scans tracked exec-policy rule files only", () => {
    const source = ts.createSourceFile(
      "check-codex-execpolicy.mjs",
      readFileSync(resolve("scripts/guards/check-codex-execpolicy.mjs"), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );

    expect(namedImports(source, "./lib/guard-utils.js")).toContain("gitTrackedFiles");
    expect(callNames(source)).not.toContain("fs.readdirSync");
  });
});

function namedImports(source: ts.SourceFile, moduleSpecifier: string): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === moduleSpecifier
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        names.push(...bindings.elements.map((element) => element.name.text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function callNames(source: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      names.push(node.expression.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function gitWorkflowLsFilesArgs(source: ts.SourceFile): string[] {
  const matches: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "execFileSync") {
      const [command, args] = node.arguments;
      if (
        ts.isStringLiteral(command) &&
        command.text === "git" &&
        args !== undefined &&
        ts.isArrayLiteralExpression(args)
      ) {
        const values = args.elements.filter(ts.isStringLiteral).map((element) => element.text);
        if (values.includes("ls-files") && values.includes(".github/workflows")) {
          matches.push(values);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (matches.length !== 1) {
    throw new Error(`expected one git workflow ls-files call, found ${matches.length}`);
  }
  return matches[0] ?? [];
}
