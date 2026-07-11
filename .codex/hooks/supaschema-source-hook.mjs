#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "dist", "cli.js");

if (!existsSync(cli)) {
  const npm = npmInvocation(["run", "build", "--silent"]);
  const result = spawnSync(npm.command, npm.args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

await import(pathToFileURL(cli).href);

function npmInvocation(args) {
  const execpath = process.env.npm_execpath;
  return execpath
    ? { args: [execpath, ...args], command: process.execPath }
    : { args, command: process.platform === "win32" ? "npm.cmd" : "npm" };
}
