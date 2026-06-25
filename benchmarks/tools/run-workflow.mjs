#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
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

if (spec.generatedMigrationDir) {
  const migrations = (await readdir(spec.generatedMigrationDir))
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
  if (migrations.length !== 1) {
    process.stderr.write(
      `workflow generated ${migrations.length} migration files; expected exactly one\n`
    );
    process.exit(1);
  }
  await copyFile(`${spec.generatedMigrationDir}/${migrations[0]}`, spec.migrationPath);
}

if (spec.applyDatabaseUrl) {
  const migrationSql = await readFile(spec.migrationPath, "utf8");
  if (migrationSql.trim()) {
    process.stderr.write("workflow: applying migration\n");
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
    const child = spawn(step.command, step.args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killChild = (signal) => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          child.kill(signal);
          return;
        }
      }
      child.kill(signal);
    };
    const onTerm = () => killChild("SIGTERM");
    const onInt = () => killChild("SIGINT");
    process.on("SIGTERM", onTerm);
    process.on("SIGINT", onInt);
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    const finish = (handler) => (value) => {
      process.removeListener("SIGTERM", onTerm);
      process.removeListener("SIGINT", onInt);
      handler(value);
    };
    child.on("error", finish(rejectRun));
    child.on("close", (exitCode) => {
      finish(resolveRun)({ exitCode: exitCode ?? 1, stdout });
    });
  });
}
