import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { run } from "./process.js";

export const ROOT = path.resolve(resolveRoot());

export function readJson(file, root) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

export function readText(file, root) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

export function exists(file, root) {
  return fs.existsSync(path.join(root, file));
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
