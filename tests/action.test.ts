import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
});
