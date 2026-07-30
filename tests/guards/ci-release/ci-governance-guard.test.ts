import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("CI governance guard", () => {
  it("scans cached workflow files only", () => {
    const source = ts.createSourceFile(
      "ci-yaml-primitives.mjs",
      readFileSync(resolve("scripts/guards/ci-release/ci-yaml-primitives.mjs"), "utf8"),
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

  it("covers the snapshot publish lane invariants", () => {
    const source = readFileSync(
      resolve("scripts/guards/ci-release/check-ci-governance.mjs"),
      "utf8"
    );
    expect(source).toContain('parsed.get("snapshot.yml")');
    expect(source).toContain("snapshot-npm");
    expect(source).toContain("--tag next");
    expect(source).toContain("node scripts/release/snapshot-version.mjs");
    expect(source).toContain("SUPASCHEMA_REGISTRY_SMOKE_SPEC");
  });

  it("covers the consumer canary lane invariants", () => {
    const source = readFileSync(
      resolve("scripts/guards/ci-release/check-ci-governance.mjs"),
      "utf8"
    );
    expect(source).toContain('parsed.get("consumer-canary.yml")');
    expect(source).toContain("secrets.CONSUMER_CANARY_TOKEN");
    expect(source).toContain("node scripts/release/consumer-canary.mjs");
  });

  it("scans tracked exec-policy rule files only", () => {
    const source = ts.createSourceFile(
      "check-codex-execpolicy.mjs",
      readFileSync(resolve("scripts/guards/ci-release/check-codex-execpolicy.mjs"), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );

    expect(namedImports(source, "../lib/repository.js")).toContain("gitTrackedFiles");
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
