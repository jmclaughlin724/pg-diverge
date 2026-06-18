#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const scanReportMarker = "<!-- supaschema:scan-report -->";
const defaultApiUrl = "https://api.github.com";
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));

export function validateExactVersion(version) {
  if (typeof version !== "string" || !isExactVersion(version)) {
    throw new Error(`invalid supaschema version: ${version} (use an exact npm version)`);
  }
  return version;
}

export function readPackageVersion(readFile = readFileSync) {
  const packageJson = JSON.parse(readFile(packageJsonPath, "utf8"));
  return validateExactVersion(packageJson.version);
}

export function resolveActionVersion(version, readFile = readFileSync) {
  if (version === undefined || version.length === 0) {
    return readPackageVersion(readFile);
  }
  return validateExactVersion(version);
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
  fetchImpl = globalThis.fetch,
  readFile = readFileSync,
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  const version = resolveActionVersion(env.SUPASCHEMA_ACTION_VERSION, readFile);
  const argv = parseActionArgv(env.SUPASCHEMA_ACTION_ARGV);
  const command = npxCommand(platform);
  const args = buildNpxArgs(version, argv);
  const result = await runSupaschema(command, args, env, spawnImpl);
  await publishActionReport({ argv, env, fetchImpl, readFile, result });
  return result.code;
}

async function runSupaschema(command, args, env, spawnImpl) {
  return await new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on?.("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on?.("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      process.stderr.write(`supaschema action failed to start: ${error.message}\n`);
      resolve({ code: 1, stderr: error.message, stdout });
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        process.stderr.write(`supaschema action terminated by ${signal}\n`);
        resolve({
          code: 1,
          stderr: `${stderr}\nsupaschema action terminated by ${signal}`,
          stdout,
        });
        return;
      }
      resolve({ code: typeof code === "number" ? code : 1, stderr, stdout });
    });
  });
}

export async function publishActionReport({
  argv,
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFile = readFileSync,
  result,
}) {
  if (argv[0] !== "scan") {
    return;
  }
  const report = parseScanReport(result.stdout);
  if (report === undefined) {
    if (env.SUPASCHEMA_ACTION_GITHUB_TOKEN) {
      throw new Error('scan reporting requires argv to include "--reporter","json"');
    }
    return;
  }
  const body = renderActionScanMarkdown(report, result.code);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${body}\n`);
  }
  if (!env.SUPASCHEMA_ACTION_GITHUB_TOKEN) {
    return;
  }
  const context = githubContext(env, readFile);
  await createScanCheckRun(context, env, fetchImpl, report, body, result.code);
  if (context.pullNumber !== undefined) {
    await upsertScanComment(context, env, fetchImpl, body);
  }
}

export function parseScanReport(output) {
  let parsed;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }
  if (
    typeof parsed.file !== "string" ||
    typeof parsed.score !== "number" ||
    typeof parsed.grade !== "string" ||
    typeof parsed.errorCount !== "number" ||
    typeof parsed.warningCount !== "number" ||
    !Array.isArray(parsed.diagnostics)
  ) {
    return;
  }
  return parsed;
}

export function renderActionScanMarkdown(report, code) {
  const conclusion = code === 0 ? "passed" : "failed";
  const lines = [
    scanReportMarker,
    "## supaschema scan",
    "",
    `Result: **${conclusion}**`,
    `Score: **${report.score}/100 (${report.grade})**`,
    `Errors: **${report.errorCount}**`,
    `Warnings: **${report.warningCount}**`,
  ];
  const diagnostics = report.diagnostics.slice(0, 5);
  if (diagnostics.length > 0) {
    lines.push("", "| Severity | Code | Message |", "| --- | --- | --- |");
    for (const item of diagnostics) {
      lines.push(
        `| ${escapeMarkdownCell(String(item.severity ?? ""))} | ${escapeMarkdownCell(
          String(item.code ?? "")
        )} | ${escapeMarkdownCell(String(item.message ?? ""))} |`
      );
    }
  }
  return lines.join("\n");
}

function githubContext(env, readFile) {
  const repo = splitRepository(env.GITHUB_REPOSITORY);
  const event = readGithubEvent(env, readFile);
  const pullRequest = isRecord(event.pull_request) ? event.pull_request : undefined;
  const pullNumber = typeof pullRequest?.number === "number" ? pullRequest.number : undefined;
  const pullHead = isRecord(pullRequest?.head) ? pullRequest.head : undefined;
  let sha = env.GITHUB_SHA;
  if (typeof event.after === "string") {
    sha = event.after;
  }
  if (typeof pullHead?.sha === "string") {
    sha = pullHead.sha;
  }
  if (!sha) {
    throw new Error("GITHUB_SHA or pull_request.head.sha is required for scan check reporting");
  }
  return { ...repo, pullNumber, sha };
}

function splitRepository(value) {
  if (!value) {
    throw new Error("GITHUB_REPOSITORY is required for scan reporting");
  }
  const separator = value.indexOf("/");
  if (separator <= 0 || separator >= value.length - 1) {
    throw new Error(`invalid GITHUB_REPOSITORY: ${value}`);
  }
  return { owner: value.slice(0, separator), repo: value.slice(separator + 1) };
}

function readGithubEvent(env, readFile) {
  if (!env.GITHUB_EVENT_PATH) {
    return {};
  }
  const content = readFile(env.GITHUB_EVENT_PATH, "utf8");
  const parsed = JSON.parse(content);
  return isRecord(parsed) ? parsed : {};
}

async function createScanCheckRun(context, env, fetchImpl, report, body, code) {
  await githubRequest(
    env,
    fetchImpl,
    "POST",
    `/repos/${context.owner}/${context.repo}/check-runs`,
    {
      completed_at: new Date().toISOString(),
      conclusion: code === 0 ? "success" : "failure",
      head_sha: context.sha,
      name: "supaschema scan",
      output: {
        summary: body,
        title: `Postgres safety ${report.score}/100 (${report.grade})`,
      },
      status: "completed",
    }
  );
}

async function upsertScanComment(context, env, fetchImpl, body) {
  const comments = await githubRequest(
    env,
    fetchImpl,
    "GET",
    `/repos/${context.owner}/${context.repo}/issues/${context.pullNumber}/comments?per_page=100`
  );
  const existing = Array.isArray(comments)
    ? comments.find((comment) => isRecord(comment) && existingScanComment(comment))
    : undefined;
  if (isRecord(existing) && typeof existing.id === "number") {
    await githubRequest(
      env,
      fetchImpl,
      "PATCH",
      `/repos/${context.owner}/${context.repo}/issues/comments/${existing.id}`,
      {
        body,
      }
    );
    return;
  }
  await githubRequest(
    env,
    fetchImpl,
    "POST",
    `/repos/${context.owner}/${context.repo}/issues/${context.pullNumber}/comments`,
    {
      body,
    }
  );
}

function existingScanComment(comment) {
  const user = isRecord(comment.user) ? comment.user : {};
  return (
    typeof comment.body === "string" &&
    comment.body.includes(scanReportMarker) &&
    user.type === "Bot"
  );
}

async function githubRequest(env, fetchImpl, method, path, body) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is required for GitHub scan reporting");
  }
  const response = await fetchImpl(`${env.GITHUB_API_URL || defaultApiUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.SUPASCHEMA_ACTION_GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    method,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text}`);
  }
  return text.length > 0 ? JSON.parse(text) : undefined;
}

function escapeMarkdownCell(value) {
  return value.split("|").join("\\|").split("\n").join(" ").split("\r").join(" ");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
