#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const exactVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateExactVersion(version) {
  if (typeof version !== "string" || !exactVersionPattern.test(version)) {
    throw new Error(
      `invalid supaschema version: ${version} (use an exact npm version, e.g. 0.2.4)`
    );
  }
  return version;
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
