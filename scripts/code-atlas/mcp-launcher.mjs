#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const status = takeFlag(args, "--status");
const workspace = path.resolve(args[0] ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const resolution = resolveMcp();

if (status) {
  process.stdout.write(
    `${JSON.stringify(
      {
        available: Boolean(resolution),
        source: resolution?.source ?? "none",
        binary: resolution?.binary ?? null,
        version: resolution?.version ?? null,
        npxFallbackEnabled: process.env.CODEATLAS_MCP_ALLOW_NPX === "1",
        workspace,
        launcher: path.relative(workspace, new URL(import.meta.url).pathname),
      },
      null,
      2
    )}\n`
  );
  process.exit(0);
}

if (!resolution) {
  process.stderr.write(
    "Code Atlas live MCP is not available. Set CODEATLAS_MCP_BIN, install the editor extension, or explicitly allow npx fallback with CODEATLAS_MCP_ALLOW_NPX=1.\n"
  );
  process.exit(1);
}

const child = spawn(resolution.command, [...resolution.args, workspace], {
  cwd: workspace,
  env: {
    ...process.env,
    CODEATLAS_WORKSPACE: workspace,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 1);
});

function resolveMcp() {
  const envBinary = process.env.CODEATLAS_MCP_BIN;
  if (envBinary) {
    return {
      source: "env",
      binary: envBinary,
      command: envBinary,
      args: [],
      version: versionFor(envBinary),
    };
  }
  const extension = resolveEditorExtension();
  if (extension) {
    return extension;
  }
  if (process.env.CODEATLAS_MCP_ALLOW_NPX === "1") {
    return {
      source: "npx",
      binary: "npx -y @codeatlas/mcp@latest",
      command: "npx",
      args: ["-y", "@codeatlas/mcp@latest"],
      version: null,
    };
  }
  return;
}

function resolveEditorExtension() {
  const extensionDirs = [
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".cursor", "extensions"),
    path.join(os.homedir(), ".windsurf", "extensions"),
  ];
  const candidates = [];
  for (const extensionDir of extensionDirs) {
    if (!fs.existsSync(extensionDir)) {
      continue;
    }
    for (const name of fs.readdirSync(extensionDir)) {
      if (!name.startsWith("codeatlaslive.codeatlas-live-")) {
        continue;
      }
      const extensionPath = path.join(extensionDir, name);
      const version = name.slice("codeatlaslive.codeatlas-live-".length);
      const binary = extensionBinary(extensionPath);
      if (binary) {
        candidates.push({ extensionPath, binary, version });
      }
    }
  }
  candidates.sort((left, right) => compareVersions(right.version, left.version));
  const best = candidates[0];
  if (!best) {
    return;
  }
  return {
    source: "editor-extension",
    binary: best.binary,
    command: "node",
    args: [best.binary],
    version: best.version,
  };
}

function extensionBinary(extensionPath) {
  const packageJson = path.join(extensionPath, "package.json");
  if (fs.existsSync(packageJson)) {
    const parsed = readJsonFile(packageJson);
    if (parsed !== undefined) {
      const bin = parsed?.bin?.codeatlas ?? parsed?.bin?.["codeatlas-mcp"] ?? parsed?.bin?.mcp;
      if (typeof bin === "string" && fs.existsSync(path.join(extensionPath, bin))) {
        return path.join(extensionPath, bin);
      }
    }
  }
  const candidates = [
    "dist/mcp.js",
    "dist/server.js",
    "out/mcp.js",
    "out/server.js",
    "mcp.js",
    "server.js",
  ];
  return candidates
    .map((candidate) => path.join(extensionPath, candidate))
    .find((candidate) => fs.existsSync(candidate));
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return;
  }
}

function versionFor(binary) {
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const width = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < width; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.localeCompare(right);
}

function versionParts(version) {
  return version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function takeFlag(targetArgs, flag) {
  const index = targetArgs.indexOf(flag);
  if (index === -1) {
    return false;
  }
  targetArgs.splice(index, 1);
  return true;
}
