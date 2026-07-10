#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAgentSurfaces } from "../../skills/sync-llm.mjs";
import { assert, ok } from "../lib/assertions.js";
import { ROOT } from "../lib/repository.js";

export function check(root = ROOT) {
  const errors = checkAgentSurfaces({ root });
  assert(errors.length === 0, errors.join("\n"));

  for (const surface of [".claude", ".agents", ".codex"]) {
    assert(
      !fs.existsSync(path.join(root, surface, "skills", "gitnexus")),
      `project GitNexus skills must not be bundled under ${surface}/skills/gitnexus`
    );
  }

  const publicSkillDirs = fs
    .readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert(
    JSON.stringify(publicSkillDirs) === JSON.stringify(["supaschema"]),
    `public skills must expose only supaschema; found ${publicSkillDirs.join(", ")}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("AGENT_SURFACE_PARITY_OK");
}
