#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function validateExactVersion(version) {
  if (typeof version !== "string" || !isExactVersion(version)) {
    throw new Error(
      `invalid supaschema version: ${version} (use an exact npm version, e.g. 0.2.4)`
    );
  }
  return version;
}

function isExactVersion(version) {
  const plusParts = version.split("+");
  if (plusParts.length > 2) {
    return false;
  }
  const build = plusParts[1];
  const dashParts = plusParts[0].split("-");
  if (dashParts.length > 2) {
    return false;
  }
  const core = dashParts[0];
  const prerelease = dashParts[1];
  return (
    isNumericTriplet(core) &&
    (prerelease === undefined || isIdentifierList(prerelease)) &&
    (build === undefined || isIdentifierList(build))
  );
}

function isNumericTriplet(value) {
  const parts = value.split(".");
  return parts.length === 3 && parts.every(isDigits);
}

function isIdentifierList(value) {
  return value.length > 0 && value.split(".").every(isIdentifier);
}

function isIdentifier(value) {
  return value.length > 0 && [...value].every(isIdentifierChar);
}

function isIdentifierChar(char) {
  return isAsciiLetter(char) || isDigit(char) || char === "-";
}

function isAsciiLetter(char) {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigits(value) {
  return value.length > 0 && [...value].every(isDigit);
}

function isDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

export function parseActionArgv(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error('argv is required and must be a JSON array, e.g. ["diff","--fail-on-diff"]');
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`argv must be valid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("argv must be a JSON array of strings");
  }
  if (parsed.length === 0) {
    throw new Error("argv must include the supaschema command name");
  }
  for (const [index, value] of parsed.entries()) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`argv[${index}] must be a non-empty string`);
    }
  }
  return parsed;
}

export function npxCommand(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

export function buildNpxArgs(version, argv) {
  return ["--yes", `supaschema@${validateExactVersion(version)}`, ...argv];
}

export async function runAction({
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  const version = validateExactVersion(env.SUPASCHEMA_ACTION_VERSION);
  const argv = parseActionArgv(env.SUPASCHEMA_ACTION_ARGV);
  const command = npxCommand(platform);
  const args = buildNpxArgs(version, argv);

  return await new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      env: { ...env, SUPASCHEMA_SKIP_POSTINSTALL: "1" },
      shell: false,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      process.stderr.write(`supaschema action failed to start: ${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.stderr.write(`supaschema action terminated by ${signal}\n`);
        resolve(1);
        return;
      }
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

async function main() {
  try {
    process.exitCode = await runAction();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
