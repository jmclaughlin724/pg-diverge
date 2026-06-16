import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("composite action", () => {
  it("defaults to the pinned package version, not an npm dist-tag", () => {
    const root = resolve(import.meta.dirname, "..");
    const action = readFileSync(resolve(root, "action.yml"), "utf8");
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      version: string;
    };

    expect(action).toContain(`default: "${packageJson.version}"`);
    expect(action).toContain("use an exact npm version");
    expect(action).not.toContain("default: latest");
    expect(action).not.toContain("latest|next");
  });

  it("is mapped to the action metadata schema, not the workflow schema", () => {
    const root = resolve(import.meta.dirname, "..");
    const actionText = readFileSync(resolve(root, "action.yml"), "utf8");
    const action = parse(actionText) as {
      inputs?: unknown;
      jobs?: unknown;
      on?: unknown;
      runs?: { using?: string };
    };
    const settings = JSON.parse(readFileSync(resolve(root, ".vscode/settings.json"), "utf8")) as {
      "yaml.schemas"?: Record<string, string[]>;
    };

    expect(
      actionText.startsWith(
        "# yaml-language-server: $schema=https://www.schemastore.org/github-action.json"
      )
    ).toBe(true);
    expect(action.inputs).toBeDefined();
    expect(action.runs?.using).toBe("composite");
    expect(action.on).toBeUndefined();
    expect(action.jobs).toBeUndefined();
    expect(settings["yaml.schemas"]?.["https://www.schemastore.org/github-action.json"]).toContain(
      "action.yml"
    );
    expect(
      settings["yaml.schemas"]?.["https://www.schemastore.org/github-workflow.json"]
    ).toContain(".github/workflows/*.yml");
  });
});
