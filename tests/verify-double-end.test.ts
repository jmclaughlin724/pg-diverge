import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared, hoisted so the vi.mock factory can reach it.
const state = vi.hoisted(() => ({ endCalls: 0 }));

// Replace node-postgres with a fake admin client. The capability query
// (preflightCapability) answers "this role cannot CREATE DATABASE", which
// drives verifyMigration down the early-return path — the exact path where the
// pre-fix code called Client.end() twice (node-postgres #2716 can hang on the
// second end()). The fake counts end() calls so the test fails if the redundant
// call ever comes back.
vi.mock("pg", () => {
  class FakeClient {
    connect(): Promise<void> {
      return Promise.resolve();
    }
    query(text: unknown): Promise<{ rows: { can_create: boolean }[] }> {
      if (typeof text === "string" && text.includes("can_create")) {
        return Promise.resolve({ rows: [{ can_create: false }] });
      }
      return Promise.resolve({ rows: [] });
    }
    end(): Promise<void> {
      state.endCalls += 1;
      return Promise.resolve();
    }
  }
  return { Client: FakeClient, default: { Client: FakeClient } };
});

const { verifyMigration } = await import("../src/verify.js");

describe("verify admin client lifecycle (plan 004)", () => {
  beforeEach(() => {
    state.endCalls = 0;
  });

  it("ends the admin client exactly once on the capability-preflight failure path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "supa-verify-end-"));
    const migrationPath = join(dir, "m.sql");
    await writeFile(migrationPath, "CREATE TABLE IF NOT EXISTS app.t (id bigint PRIMARY KEY);\n");
    const emptyFrom = await mkdtemp(join(tmpdir(), "supa-verify-from-"));
    const emptyTo = await mkdtemp(join(tmpdir(), "supa-verify-to-"));

    const diagnostics = await verifyMigration({
      config: { managedSchemas: [], validators: ["internal-parser"] },
      databaseUrl: "postgresql://localhost:5432/postgres",
      from: `dir:${emptyFrom}`,
      migrationPath,
      to: `dir:${emptyTo}`,
    });

    // The preflight failure must surface, proving we reached the early-return path.
    expect(diagnostics.map((item) => item.code)).toContain("SUPA_VERIFY_ROLE_CAPABILITY");
    // The fix: the finally block is the sole owner of end(); the pre-fix code
    // called it twice (line 56 + the finally), which this asserts against.
    expect(state.endCalls).toBe(1);
  });
});
