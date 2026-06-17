import { describe, expect, it } from "vitest";
import { hasUnredactedSecret, redactSecrets } from "../src/redaction.js";

describe("secret redaction (S1)", () => {
  it("masks the password in a postgres connection URL", () => {
    const out = redactSecrets("postgres://app:s3cr3t@db.example.com:5432/prod");
    expect(out).toBe("postgres://app:***@db.example.com:5432/prod");
    expect(out).not.toContain("s3cr3t");
  });

  it("masks a password key/value pair", () => {
    expect(redactSecrets("connection failed: password=hunter2")).toBe(
      "connection failed: password=***"
    );
  });

  it("masks passwd and prefixed password variants", () => {
    expect(redactSecrets("FATAL: passwd=hunter2")).toBe("FATAL: passwd=***");
    expect(redactSecrets("db_password=hunter2")).toBe("db_password=***");
    expect(redactSecrets("PGPASSWORD=hunter2")).toBe("PGPASSWORD=***");
  });

  it("redacts a long credential-free of quadratic blowup", () => {
    const long = `postgres://user:${"a".repeat(40_000)}`;
    const start = process.hrtime.bigint();
    redactSecrets(long);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(ms).toBeLessThan(50);
  });

  it("leaves text without credentials unchanged", () => {
    const clean = 'Table "users" is not snake_case';
    expect(redactSecrets(clean)).toBe(clean);
  });

  it("detects and clears credentials through redaction", () => {
    const text = "postgres://u:p@h/db";
    expect(hasUnredactedSecret(text)).toBe(true);
    expect(hasUnredactedSecret(redactSecrets(text))).toBe(false);
  });

  it("is stable across repeated detection calls (no /g lastIndex drift)", () => {
    const text = "postgres://u:p@h/db";
    expect(hasUnredactedSecret(text)).toBe(true);
    expect(hasUnredactedSecret(text)).toBe(true);
  });
});
