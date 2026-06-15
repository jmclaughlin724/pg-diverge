import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isActivePath, ROOT } from "./config.mjs";

export function gitFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "git ls-files failed");
  }
  return result.stdout.split("\0").filter(Boolean).filter(isActivePath).filter(existsRel).sort();
}

export function existsRel(file) {
  return fs.existsSync(path.join(ROOT, file));
}

export function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

export function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}

export function contentDigest(file) {
  const hash = crypto.createHash("sha256");
  hash.update(readText(file));
  return hash.digest("hex");
}

export function inputFingerprint(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readText(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function readCachedAtlas(outputPath) {
  if (!fs.existsSync(outputPath)) {
    return;
  }
  return safeJson(fs.readFileSync(outputPath, "utf8"));
}

export function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
