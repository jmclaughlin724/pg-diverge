import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

async function git(args) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

function snapshotSha(version) {
  if (typeof version !== "string") {
    return null;
  }
  const marker = "-dev.";
  const at = version.lastIndexOf(marker);
  if (at === -1) {
    return null;
  }
  const sha = version.slice(at + marker.length);
  return sha.length > 0 && [...sha].every((char) => "0123456789abcdef".includes(char))
    ? sha
    : null;
}

const raw = await readFile(join(root, "package.json"), "utf8");
const version = JSON.parse(raw).version;
const commit = await git(["rev-parse", "HEAD"]);
const porcelain = await git(["status", "--porcelain"]);

const devSha = snapshotSha(version);
const builtAt =
  devSha === null
    ? new Date().toISOString()
    : ((await git(["show", "-s", "--format=%cI", devSha])) ?? new Date().toISOString());

const stamp = {
  version: typeof version === "string" ? version : "0.0.0",
  commit,
  builtAt,
  dirty: porcelain === null ? null : porcelain.length > 0,
};

await writeFile(join(root, "dist", "build-info.json"), `${JSON.stringify(stamp, null, 2)}\n`);
