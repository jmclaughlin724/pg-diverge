import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adapters } from "../../benchmarks/tools/registry.js";

describe("benchmark adapter registry", () => {
  it("passes the workflow target as a runtime source override", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "supaschema-benchmark-registry-"));
    try {
      const adapter = adapters.find((candidate) => candidate.id === "supaschema-workflow");
      expect(adapter).toBeDefined();

      await adapter?.command({
        fromSqlPath: join(runRoot, "from.sql"),
        outputPath: join(runRoot, "migration.sql"),
        runRoot,
        toSqlPath: join(runRoot, "to.sql"),
      });

      const config = JSON.parse(
        await readFile(join(runRoot, "supaschema.workflow.config.json"), "utf8")
      );
      expect(config.sources).toEqual({ from: `dump:${join(runRoot, "from.sql")}` });

      const spec = JSON.parse(await readFile(join(runRoot, "workflow.json"), "utf8"));
      expect(spec.diff.args).toContain("sync");
      expect(spec.diff.args.slice(-2)).toEqual(["--to", `dump:${join(runRoot, "to.sql")}`]);
    } finally {
      await rm(runRoot, { force: true, recursive: true });
    }
  });
});
