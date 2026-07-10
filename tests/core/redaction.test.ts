import { describe, expect, it } from "vitest";
import { hasUnredactedSecret, redactSecrets } from "../../src/redaction.js";

describe("secret redaction (S1)", () => {
  it("masks the password in a postgres connection URL", () => {
    const out = redactSecrets("postgres://app:s3cr3t@db.example.com:5432/prod");
    expect(out).toBe("postgres://app:[redacted]@db.example.com:5432/prod");
    expect(out).not.toContain("s3cr3t");
  });

  it("masks long URL passwords before reports are published", () => {
    const password = "s".repeat(300);
    const out = redactSecrets(`postgres://app:${password}@db.example.com/prod`);
    expect(out).toBe("postgres://app:[redacted]@db.example.com/prod");
    expect(out).not.toContain(password);
  });

  it("masks a password key/value pair", () => {
    expect(redactSecrets("connection failed: password=hunter2")).toBe(
      "connection failed: password=[redacted]"
    );
  });

  it("masks passwd and prefixed password variants", () => {
    expect(redactSecrets("FATAL: passwd=hunter2")).toBe("FATAL: passwd=[redacted]");
    expect(redactSecrets("PWD=hunter2")).toBe("PWD=[redacted]");
    expect(redactSecrets("db_password=hunter2")).toBe("db_password=[redacted]");
    expect(redactSecrets("PGPASSWORD=hunter2")).toBe("PGPASSWORD=[redacted]");
  });

  it("masks token and API key variants", () => {
    expect(redactSecrets("access_token=hunter2")).toBe("access_token=[redacted]");
    expect(redactSecrets("api-key=hunter2")).toBe("api-key=[redacted]");
    expect(redactSecrets("service-role-key=hunter2")).toBe("service-role-key=[redacted]");
  });

  it("redacts quoted JSON-style secret properties", () => {
    const redacted = redactSecrets('{"password":"hunter2","api_key":"abc123"}');
    expect(redacted).toBe('{"password":"[redacted]","api_key":"[redacted]"}');
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abc123");
  });

  it("keeps already redacted assignment values idempotent", () => {
    expect(redactSecrets("password=[redacted]")).toBe("password=[redacted]");
    expect(redactSecrets("password=[redacted]hunter2")).toBe("password=[redacted]");
    expect(redactSecrets('{"password":"[redacted]"}')).toBe('{"password":"[redacted]"}');
    expect(hasUnredactedSecret("password=[redacted]")).toBe(false);
    expect(hasUnredactedSecret('{"password":"[redacted]"}')).toBe(false);
  });

  it("keeps already redacted Supabase secret values idempotent", () => {
    expect(redactSecrets("sb_secret_[redacted]")).toBe("sb_secret_[redacted]");
    expect(redactSecrets("sb_secret_[redacted]abc123")).toBe("sb_secret_[redacted]");
    expect(hasUnredactedSecret("sb_secret_[redacted]")).toBe(false);
    expect(hasUnredactedSecret("sb_secret_[redacted]abc123")).toBe(true);
    expect(hasUnredactedSecret(redactSecrets("sb_secret_[redacted]abc123"))).toBe(false);
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

  it("is stable across repeated detection calls", () => {
    const text = "postgres://u:p@h/db";
    expect(hasUnredactedSecret(text)).toBe(true);
    expect(hasUnredactedSecret(text)).toBe(true);
  });
});
