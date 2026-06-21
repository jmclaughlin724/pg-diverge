import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(resolveRoot());

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

export function readJson(file, root) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

export function readText(file, root) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

export function exists(file, root) {
  return fs.existsSync(path.join(root, file));
}

export function run(command, args, options, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

export function gitFiles(root) {
  const result = run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {},
    root
  );
  return result.stdout.split("\0").filter(Boolean).sort();
}

export function gitTrackedFiles(root) {
  const result = run("git", ["ls-files", "-z", "--cached"], {}, root);
  return result.stdout.split("\0").filter(Boolean).sort();
}

export function edgeKey(edge) {
  return `${edge.from}\0${edge.to}\0${edge.type}\0${edge.evidence ?? ""}`;
}

function resolveRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) {
    const root = result.stdout.trim();
    if (root.length > 0) {
      return root;
    }
  }
  return process.cwd();
}
