import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/core.js";
import {
  createRemediationDrafter,
  type RemediationTransport,
  selectRemediationModel,
} from "../src/remediation-client.js";

const models = { capable: "big-model", cheap: "small-model" };

function diagnostic(code: string, severity: "error" | "warning"): Diagnostic {
  return {
    code,
    message: `${code} message`,
    ref: { kind: "table", name: code, schema: "public" },
    severity,
  };
}

describe("remediation client (M33)", () => {
  it("routes errors to the capable model and warnings to the cheap model", () => {
    expect(selectRemediationModel(diagnostic("E", "error"), models)).toBe("big-model");
    expect(selectRemediationModel(diagnostic("W", "warning"), models)).toBe("small-model");
  });

  it("caches identical findings — a single transport call", async () => {
    let calls = 0;
    const transport: RemediationTransport = () => {
      calls += 1;
      return Promise.resolve("CORRECTED SQL");
    };
    const drafter = createRemediationDrafter(transport, models, { maxRequests: 10 });
    const first = await drafter.draft(diagnostic("X", "warning"));
    const second = await drafter.draft(diagnostic("X", "warning"));
    expect(first?.cached).toBe(false);
    expect(second?.cached).toBe(true);
    expect(second?.fix).toBe("CORRECTED SQL");
    expect(calls).toBe(1);
    expect(drafter.requestsUsed()).toBe(1);
  });

  it("enforces the request budget (cost cap)", async () => {
    const transport: RemediationTransport = () => Promise.resolve("FIX");
    const drafter = createRemediationDrafter(transport, models, { maxRequests: 1 });
    expect(await drafter.draft(diagnostic("A", "error"))).not.toBeNull();
    expect(await drafter.draft(diagnostic("B", "error"))).toBeNull();
    expect(drafter.requestsUsed()).toBe(1);
  });
});
