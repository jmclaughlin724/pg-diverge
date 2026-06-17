import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/core.js";
import { remediationCacheKey, remediationPrompt } from "../src/remediation.js";

const finding: Diagnostic = {
  code: "SUPA_RULE_RLS_NO_POLICY",
  hint: "RLS with no policy denies all access",
  message: 'RLS is enabled on "public.accounts" but no policy exists',
  ref: { kind: "rls", name: "accounts", schema: "public", table: "accounts" },
  severity: "warning",
};

describe("remediation prompt (M33)", () => {
  it("includes the code, severity, message, hint, and location", () => {
    const prompt = remediationPrompt(finding);
    expect(prompt).toContain("SUPA_RULE_RLS_NO_POLICY");
    expect(prompt).toContain("warning");
    expect(prompt).toContain("public.accounts");
    expect(prompt).toContain("RLS with no policy");
    expect(prompt).toContain("rls public.accounts");
  });

  it("omits the guidance line when there is no hint", () => {
    const noHint: Diagnostic = {
      code: "SUPA_TYPE_COLUMN_REMOVED",
      message: "column removed",
      ref: { kind: "table", name: "users", schema: "public" },
      severity: "error",
    };
    expect(remediationPrompt(noHint)).not.toContain("Guidance:");
  });
});

describe("remediation cache key (M33)", () => {
  it("is stable for the same finding", () => {
    expect(remediationCacheKey(finding)).toBe(remediationCacheKey(finding));
  });

  it("differs when the code differs", () => {
    const other: Diagnostic = { ...finding, code: "SUPA_RULE_POLICY_NO_RLS" };
    expect(remediationCacheKey(other)).not.toBe(remediationCacheKey(finding));
  });
});
