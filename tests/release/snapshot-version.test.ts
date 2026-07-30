import { describe, expect, it } from "vitest";
import { computeSnapshotVersion } from "../../scripts/release/snapshot-version.mjs";

describe("computeSnapshotVersion", () => {
  it("bumps the patch and appends the dev prerelease", () => {
    expect(computeSnapshotVersion("0.5.5", "abc1234")).toBe("0.5.6-dev.abc1234");
    expect(computeSnapshotVersion("1.0.0", "deadbee")).toBe("1.0.1-dev.deadbee");
  });

  it("rejects non-stable base versions", () => {
    expect(() => computeSnapshotVersion("0.5.6-dev.abc1234", "abc1234")).toThrow(
      "stable X.Y.Z base version"
    );
    expect(() => computeSnapshotVersion("0.5", "abc1234")).toThrow("stable X.Y.Z base version");
  });
});
