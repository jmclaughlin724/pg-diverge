#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { applyMigrationSql } from "./compare-db.mjs";

const specPath = process.argv[2];
if (!specPath) {
  process.stderr.write("usage: run-workflow.mjs <workflow-spec.json>\n");
  process.exit(64);
}
const spec = JSON.parse(await readFile(specPath, "utf8"));

const diff = await run(spec.diff);
if (diff.exitCode !== 0) {
  process.stderr.write(`workflow diff failed (exit ${diff.exitCode})\n`);
  process.exit(diff.exitCode || 1);
}

if (spec.applyDatabaseUrl) {
  const migrationSql = await readFile(spec.migrationPath, "utf8");
  if (migrationSql.trim()) {
    await applyMigrationSql(spec.applyDatabaseUrl, migrationSql);
  }
}

if (spec.genTypes) {
  const genTypes = await run(spec.genTypes);
  if (genTypes.exitCode !== 0) {
    process.stderr.write(`workflow gen types failed (exit ${genTypes.exitCode})\n`);
    process.exit(genTypes.exitCode || 1);
  }
  await writeFile(spec.genTypes.outPath, genTypes.stdout, "utf8");
}

function run(step) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(step.command, step.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("error", rejectRun);
    child.on("close", (exitCode) => {
      resolveRun({ exitCode: exitCode ?? 1, stdout });
    });
  });
}
