#!/usr/bin/env node
import { runSkillHook } from "./skill-hook-core.mjs";

runSkillHook({
  command: process.argv[2] ?? "match",
  runtime: process.env.SKILL_GATE_RUNTIME ?? "claude",
});
