import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  buildNpxArgs,
  parseActionArgv,
  validateExactVersion,
} from "../scripts/actions/run-supaschema-action.mjs";

const githubExpression = (name: string) => `${"$"}{{ ${name} }}`;
const shellParameter = (name: string) => `${"$"}{${name}}`;

describe("composite action", () => {
  it("defaults to the pinned package version, not an npm dist-tag", () => {
    const root = resolve(import.meta.dirname, "..");
    const action = readFileSync(resolve(root, "action.yml"), "utf8");
    const actionRunner = readFileSync(
      resolve(root, "scripts/actions/run-supaschema-action.mjs"),
      "utf8"
    );
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      version: string;
    };

    expect(action).toContain(`default: "${packageJson.version}"`);
    expect(actionRunner).toContain("use an exact npm version");
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

  it("accepts structured argv input instead of raw shell args", () => {
    const root = resolve(import.meta.dirname, "..");
    const actionText = readFileSync(resolve(root, "action.yml"), "utf8");
    const action = parse(actionText) as {
      inputs?: {
        args?: unknown;
        argv?: { description?: string; required?: boolean };
      };
      runs?: { steps?: { env?: Record<string, string>; run?: string; shell?: string }[] };
    };
    const [step] = action.runs?.steps ?? [];

    expect(action.inputs?.args).toBeUndefined();
    expect(action.inputs?.argv?.required).toBe(true);
    expect(action.inputs?.argv?.description).toContain("JSON array");
    expect(step?.shell).toBe("bash");
    expect(step?.env?.SUPASCHEMA_ACTION_ARGV).toBe(githubExpression("inputs.argv"));
    expect(actionText).not.toContain("SUPASCHEMA_ACTION_ARGS");
    expect(actionText).not.toContain("$SUPASCHEMA_ACTION_ARGS");
    expect(actionText).not.toContain(shellParameter("SUPASCHEMA_ACTION_VERSION"));
    expect(step?.run).toBe('node "$GITHUB_ACTION_PATH/scripts/actions/run-supaschema-action.mjs"');
  });

  it("builds the npx invocation as argv entries without shell interpolation", () => {
    expect(parseActionArgv('["diff","--fail-on-diff","--quiet"]')).toEqual([
      "diff",
      "--fail-on-diff",
      "--quiet",
    ]);
    expect(buildNpxArgs("0.2.3", ["diff", "--fail-on-diff", "--quiet"])).toEqual([
      "--yes",
      "supaschema@0.2.3",
      "diff",
      "--fail-on-diff",
      "--quiet",
    ]);
    expect(() => parseActionArgv('"diff --fail-on-diff"')).toThrow("argv must be a JSON array");
    expect(() => parseActionArgv('["diff",null]')).toThrow("argv[1] must be a non-empty string");
    expect(() => validateExactVersion("latest")).toThrow("use an exact npm version");
  });
});
