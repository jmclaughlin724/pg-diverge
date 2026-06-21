import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { check } from "../../../scripts/guards/repo-surface/check-repo-layout.mjs";
import { tempGuardRepo } from "../../guard-fixture.js";

function trackedRepo(files: Record<string, string>): string {
  const root = tempGuardRepo(files);
  execFileSync("git", ["add", ...Object.keys(files)], { cwd: root, stdio: "ignore" });
  return root;
}

function guardMessage(root: string): string {
  try {
    check(root);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("repo layout guard", () => {
  it("flags shared _shared utils helpers common and misc directories", () => {
    const message = guardMessage(
      trackedRepo({
        "src/shared/a.ts": "export const a = 1;\n",
        "src/utils/b.ts": "export const b = 1;\n",
        "src/helpers/c.ts": "export const c = 1;\n",
        "src/common/d.ts": "export const d = 1;\n",
        "src/misc/e.ts": "export const e = 1;\n",
      })
    );
    expect(message).toContain("src/shared");
    expect(message).toContain("src/utils");
    expect(message).toContain("src/helpers");
    expect(message).toContain("src/common");
    expect(message).toContain("src/misc");
  });

  it("flags shared file basenames and private underscore directories", () => {
    const message = guardMessage(
      trackedRepo({
        "scripts/shared.mjs": "export const s = 1;\n",
        "src/_private/x.ts": "export const x = 1;\n",
      })
    );
    expect(message).toContain("scripts/shared.mjs");
    expect(message).toContain("src/_private");
  });

  it("does not flag owner-scoped names that only contain a dump substring", () => {
    const root = trackedRepo({
      "src/guard-utils.ts": "export const u = 1;\n",
      "src/catalog-helpers.ts": "export const h = 1;\n",
    });
    expect(() => check(root)).not.toThrow();
  });

  it("passes a clean owner-named layout", () => {
    const root = trackedRepo({
      "src/owner/named.ts": "export const n = 1;\n",
    });
    expect(() => check(root)).not.toThrow();
  });
});
