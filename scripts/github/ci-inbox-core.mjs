import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const ciFailureMarker = "<!-- supaschema:ci-failure-report -->";

const dataPrefix = "<!-- supaschema:ci-failure-report:data ";
const dataSuffix = " -->";
const defaultTtlMs = 120_000;
const failureConclusions = new Set(["action_required", "failure", "startup_failure", "timed_out"]);
const successConclusions = new Set(["cancelled", "neutral", "skipped", "success"]);
const maxJobs = 8;
const maxAnnotations = 5;
const maxLogLines = 12;
const maxCommentLength = 55_000;

export function reportFromWorkflowRunEvent(event, env = process.env) {
  const run = event?.workflow_run;
  const repository = env.GITHUB_REPOSITORY ?? event?.repository?.full_name;
  const pullRequest = Array.isArray(run?.pull_requests) ? run.pull_requests[0] : undefined;
  const failureConclusion = failureConclusions.has(String(run?.conclusion ?? ""));
  if (!(run && repository)) {
    return;
  }
  if (!(failureConclusion && pullRequest?.number)) {
    return;
  }

  const jobs = failedWorkflowJobs(repository, run.id);
  return normalizeReport({
    conclusion: run.conclusion,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    pullRequestNumber: pullRequest.number,
    repository,
    reportedAt: new Date().toISOString(),
    workflowName: run.name,
    workflowRunId: run.id,
    workflowRunUrl: run.html_url,
    jobs,
  });
}

export function upsertCiFailureComment(report) {
  const comments = ghJson([
    "api",
    `repos/${report.repository}/issues/${report.pullRequestNumber}/comments?per_page=100`,
  ]);
  const body = renderCiFailureReport(report);
  const existing = [...comments]
    .reverse()
    .find((comment) => typeof comment?.body === "string" && comment.body.includes(ciFailureMarker));
  if (existing?.id) {
    ghJson(
      [
        "api",
        "--method",
        "PATCH",
        `repos/${report.repository}/issues/comments/${existing.id}`,
        "--input",
        "-",
      ],
      { input: JSON.stringify({ body }) }
    );
    return { action: "updated", commentId: existing.id };
  }
  const created = ghJson(
    [
      "api",
      "--method",
      "POST",
      `repos/${report.repository}/issues/${report.pullRequestNumber}/comments`,
      "--input",
      "-",
    ],
    { input: JSON.stringify({ body }) }
  );
  return { action: "created", commentId: created?.id };
}

export function renderCiFailureReport(report) {
  const normalized = normalizeReport(report);
  const encoded = Buffer.from(JSON.stringify(normalized), "utf8").toString("base64");
  const lines = [
    ciFailureMarker,
    `${dataPrefix}${encoded}${dataSuffix}`,
    "",
    "## CI failure report",
    "",
    `- Workflow: ${linkOrText(normalized.workflowName, normalized.workflowRunUrl)}`,
    `- Run ID: ${normalized.workflowRunId}`,
    `- PR: #${normalized.pullRequestNumber}`,
    `- Head: \`${shortSha(normalized.headSha)}\``,
    `- Reported: ${normalized.reportedAt}`,
    "",
    "### Failed jobs",
    "",
  ];

  if (normalized.jobs.length === 0) {
    lines.push("- Workflow concluded as failure, but no failed job details were available.");
  }

  for (const [index, job] of normalized.jobs.entries()) {
    lines.push(`${index + 1}. ${linkOrText(job.name, job.url)} - ${job.conclusion}`);
    if (job.steps.length > 0) {
      lines.push(`   - Failed steps: ${job.steps.map((step) => step.name).join(", ")}`);
    }
    for (const annotation of job.annotations) {
      const location = annotation.path
        ? `${annotation.path}${annotation.startLine ? `:${annotation.startLine}` : ""}`
        : "annotation";
      lines.push(`   - ${location}: ${oneLine(annotation.message)}`);
    }
    if (job.logExcerpt.length > 0) {
      lines.push("   - Log excerpt:");
      lines.push("     ```text");
      for (const line of job.logExcerpt) {
        lines.push(`     ${line}`);
      }
      lines.push("     ```");
    }
  }

  const body = lines.join("\n").trimEnd();
  if (body.length <= maxCommentLength) {
    return `${body}\n`;
  }
  return `${body.slice(0, maxCommentLength)}\n\n_Report truncated to fit a single PR comment._\n`;
}

export function parseCiFailureReportComment(body) {
  if (typeof body !== "string" || !body.includes(ciFailureMarker)) {
    return;
  }
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(dataPrefix) && trimmed.endsWith(dataSuffix)) {
      const encoded = trimmed.slice(dataPrefix.length, trimmed.length - dataSuffix.length);
      try {
        return normalizeReport(JSON.parse(Buffer.from(encoded, "base64").toString("utf8")));
      } catch {
        return;
      }
    }
  }
}

export function ciFailureInboxContext(options = {}) {
  try {
    return ciFailureInboxContextUnsafe(options);
  } catch {
    return;
  }
}

function ciFailureInboxContextUnsafe({
  env = process.env,
  now = Date.now(),
  root = process.cwd(),
  runtime = "claude",
} = {}) {
  if (env.SUPASCHEMA_CI_INBOX_DISABLED === "1") {
    return;
  }

  const state = readInboxState(root, env);
  const headSha = env.SUPASCHEMA_CI_INBOX_HEAD_SHA ?? gitText(root, ["rev-parse", "HEAD"]);
  const branch = env.SUPASCHEMA_CI_INBOX_BRANCH ?? gitText(root, ["branch", "--show-current"]);
  if (!(headSha && branch)) {
    return;
  }

  const checkKey = `${runtime}:${branch}:${headSha}`;
  const ttlMs = Number(env.SUPASCHEMA_CI_INBOX_TTL_MS ?? defaultTtlMs);
  const force = env.SUPASCHEMA_CI_INBOX_FORCE === "1";
  if (!force && now - Number(state.checked?.[checkKey] ?? 0) < ttlMs) {
    return;
  }
  state.checked = { ...(state.checked ?? {}), [checkKey]: now };

  const report = localReport(root, env);
  writeInboxState(root, env, state);
  if (!report || report.headSha !== headSha || report.jobs.length === 0) {
    return;
  }

  const seenKey = `${runtime}:${report.headSha}:${report.workflowRunId}`;
  if (state.seen?.[seenKey]) {
    return;
  }
  state.seen = { ...(state.seen ?? {}), [seenKey]: now };
  writeInboxState(root, env, state);
  return renderInboxContext(report);
}

function localReport(root, env) {
  if (env.SUPASCHEMA_FAKE_CI_INBOX_REPORT) {
    return normalizeReport(JSON.parse(env.SUPASCHEMA_FAKE_CI_INBOX_REPORT));
  }

  const pr = ghJson(["pr", "view", "--json", "number,headRefOid,url"], {
    allowFailure: true,
    cwd: root,
  });
  if (!pr?.number) {
    return;
  }
  const headSha = env.SUPASCHEMA_CI_INBOX_HEAD_SHA ?? gitText(root, ["rev-parse", "HEAD"]);
  if (pr.headRefOid && pr.headRefOid !== headSha) {
    return;
  }
  const repository = repositoryFullName(root, env);
  if (!repository) {
    return;
  }
  const comments = ghJson(
    ["api", `repos/${repository}/issues/${pr.number}/comments?per_page=100`],
    {
      allowFailure: true,
      cwd: root,
    }
  );
  if (!Array.isArray(comments)) {
    return;
  }
  for (const comment of [...comments].reverse()) {
    const report = parseCiFailureReportComment(comment?.body);
    if (report) {
      return report;
    }
  }
}

function failedWorkflowJobs(repository, runId) {
  const response = ghJson(["api", `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`]);
  const jobs = Array.isArray(response?.jobs) ? response.jobs : [];
  return jobs
    .filter((job) => failureConclusions.has(String(job?.conclusion ?? "")))
    .slice(0, maxJobs)
    .map((job) => ({
      annotations: annotationsForJob(repository, job),
      conclusion: String(job.conclusion ?? "failure"),
      id: job.id,
      logExcerpt: logExcerptForJob(repository, job.id),
      name: String(job.name ?? "unknown job"),
      steps: failedSteps(job),
      url: String(job.html_url ?? ""),
    }));
}

function annotationsForJob(repository, job) {
  const checkRunId = checkRunIdFromJob(job);
  if (!checkRunId) {
    return [];
  }
  const annotations = ghJson(
    ["api", `repos/${repository}/check-runs/${checkRunId}/annotations?per_page=20`],
    { allowFailure: true }
  );
  if (!Array.isArray(annotations)) {
    return [];
  }
  return annotations.slice(0, maxAnnotations).map((annotation) => ({
    message: String(annotation?.message ?? ""),
    path: String(annotation?.path ?? ""),
    startLine: annotation?.start_line,
    title: String(annotation?.title ?? ""),
  }));
}

function checkRunIdFromJob(job) {
  const url = String(job?.check_run_url ?? "");
  const slash = url.lastIndexOf("/");
  return slash === -1 ? undefined : url.slice(slash + 1);
}

function logExcerptForJob(repository, jobId) {
  const output = ghText(["api", `repos/${repository}/actions/jobs/${jobId}/logs`], {
    allowFailure: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!output) {
    return [];
  }
  const lines = output.split("\n");
  const interesting = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lowered = lines[index].toLowerCase();
    if (lowered.includes("::error") || lowered.includes("failed") || lowered.includes("error:")) {
      interesting.push(index);
    }
  }
  const selected = [];
  for (const index of interesting.slice(0, 4)) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const line = lines[index + offset];
      if (line !== undefined && selected.length < maxLogLines) {
        selected.push(stripLogPrefix(line).slice(0, 220));
      }
    }
  }
  return selected;
}

function stripLogPrefix(value) {
  const marker = "Z ";
  const index = value.indexOf(marker);
  return index > 10 ? value.slice(index + marker.length) : value;
}

function failedSteps(job) {
  return (Array.isArray(job?.steps) ? job.steps : [])
    .filter((step) => {
      const conclusion = String(step?.conclusion ?? "");
      return conclusion && !successConclusions.has(conclusion);
    })
    .map((step) => ({ conclusion: step.conclusion, name: String(step.name ?? "unknown step") }));
}

function renderInboxContext(report) {
  const lines = [
    "GitHub CI failure report for this branch:",
    `- PR #${report.pullRequestNumber}`,
    `- Workflow: ${report.workflowName}`,
    `- Head: ${shortSha(report.headSha)}`,
    `- Run: ${report.workflowRunUrl}`,
    "Failed jobs:",
  ];
  for (const job of report.jobs.slice(0, 5)) {
    lines.push(`- ${job.name}: ${job.conclusion}`);
    for (const step of job.steps.slice(0, 4)) {
      lines.push(`  - step: ${step.name}`);
    }
    for (const annotation of job.annotations.slice(0, 3)) {
      lines.push(`  - ${oneLine(annotation.message)}`);
    }
    for (const logLine of job.logExcerpt.slice(0, 3)) {
      lines.push(`  - ${oneLine(logLine)}`);
    }
  }
  lines.push("Use this CI evidence before continuing or claiming the branch is green.");
  return lines.join("\n");
}

function normalizeReport(report) {
  return {
    conclusion: String(report?.conclusion ?? "failure"),
    headBranch: String(report?.headBranch ?? ""),
    headSha: String(report?.headSha ?? ""),
    jobs: Array.isArray(report?.jobs)
      ? report.jobs.map((job) => ({
          annotations: Array.isArray(job?.annotations) ? job.annotations : [],
          conclusion: String(job?.conclusion ?? "failure"),
          id: job?.id,
          logExcerpt: Array.isArray(job?.logExcerpt)
            ? job.logExcerpt.map((line) => String(line))
            : [],
          name: String(job?.name ?? "unknown job"),
          steps: Array.isArray(job?.steps) ? job.steps : [],
          url: String(job?.url ?? ""),
        }))
      : [],
    pullRequestNumber: Number(report?.pullRequestNumber ?? 0),
    reportedAt: String(report?.reportedAt ?? ""),
    repository: String(report?.repository ?? ""),
    version: 1,
    workflowName: String(report?.workflowName ?? ""),
    workflowRunId: Number(report?.workflowRunId ?? 0),
    workflowRunUrl: String(report?.workflowRunUrl ?? ""),
  };
}

function readInboxState(root, env) {
  try {
    return JSON.parse(readFileSync(statePath(root, env), "utf8"));
  } catch {
    return { checked: {}, seen: {} };
  }
}

function writeInboxState(root, env, state) {
  const file = statePath(root, env);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state)}\n`);
}

function statePath(root, env) {
  const configured = env.SUPASCHEMA_CI_INBOX_STATE_DIR;
  if (configured) {
    return join(resolve(configured), "ci-inbox-seen.json");
  }
  const gitDir = gitText(root, ["rev-parse", "--git-common-dir"]);
  let base = join(root, ".git");
  if (gitDir) {
    base = isAbsolute(gitDir) ? gitDir : join(root, gitDir);
  }
  return join(base, "supaschema", "ci-inbox-seen.json");
}

function repositoryFullName(root, env) {
  if (env.GITHUB_REPOSITORY?.includes("/")) {
    return env.GITHUB_REPOSITORY;
  }
  const remote = gitText(root, ["config", "--get", "remote.origin.url"]);
  if (!remote) {
    return;
  }
  return remoteRepository(remote);
}

function remoteRepository(remote) {
  const httpsPrefix = "https://github.com/";
  const sshPrefix = "git@github.com:";
  let value = remote;
  if (value.startsWith(httpsPrefix)) {
    value = value.slice(httpsPrefix.length);
  } else if (value.startsWith(sshPrefix)) {
    value = value.slice(sshPrefix.length);
  }
  if (value.endsWith(".git")) {
    value = value.slice(0, -4);
  }
  return value.includes("/") ? value : undefined;
}

function ghJson(args, options = {}) {
  const output = ghText(args, options);
  if (!output) {
    return;
  }
  try {
    return JSON.parse(output);
  } catch {
    return;
  }
}

function ghText(args, options = {}) {
  const result = spawnSync("gh", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  });
  if (result.status !== 0) {
    if (options.allowFailure) {
      return;
    }
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`gh ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result.stdout;
}

function gitText(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function linkOrText(label, url) {
  return url ? `[${label}](${url})` : label;
}

function oneLine(value) {
  return String(value).split("\n").join(" ").trim();
}

function shortSha(value) {
  return String(value).slice(0, 12);
}
