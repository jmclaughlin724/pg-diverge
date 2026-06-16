import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function ok(token) {
  process.stdout.write(`${token}\n`);
}

export function fail(message) {
  throw new Error(message);
}

export function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

export function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

export function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

export function gitFiles() {
  const result = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return result.stdout.split("\0").filter(Boolean).sort();
}

export function edgeKey(edge) {
  return `${edge.from}\0${edge.to}\0${edge.type}\0${edge.evidence ?? ""}`;
}
