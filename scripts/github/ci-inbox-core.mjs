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
const trustedReportAuthors = new Set(["github-actions[bot]"]);

export function reportFromWorkflowRunEvent(event, env = process.env) {
  const run = event?.workflow_run;
  const repository = env.GITHUB_REPOSITORY ?? event?.repository?.full_name;
  const pullRequest = Array.isArray(run?.pull_requests) ? run.pull_requests[0] : undefined;
  const conclusion = String(run?.conclusion ?? "");
  if (!(run && repository)) {
    return;
  }
  if (!(conclusion && pullRequest?.number)) {
    return;
  }

  const jobs = failureConclusions.has(conclusion) ? failedWorkflowJobs(repository, run.id) : [];
  return normalizeReport({
    conclusion,
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

export function upsertCiFailureComment(report, options = {}) {
  const normalized = normalizeReport(report);
  const requestJson = options.ghJson ?? ghJson;
  const currentHeadSha =
    options.currentHeadSha ?? currentPullRequestHeadSha(normalized, requestJson);
  if (currentHeadSha && currentHeadSha !== normalized.headSha) {
    return { action: "skipped-stale-head" };
  }
  const comments =
    options.comments ??
    requestJson([
      "api",
      `repos/${normalized.repository}/issues/${normalized.pullRequestNumber}/comments?per_page=100`,
    ]);
  const trustedComments = trustedCiReportComments(comments);
  if (!reportHasFailureConclusion(normalized)) {
    const existing = [...trustedComments]
      .reverse()
      .find((comment) => parseCiFailureReportComment(comment.body)?.headSha === normalized.headSha);
    if (!existing?.id) {
      return { action: "none" };
    }
    requestJson([
      "api",
      "--method",
      "DELETE",
      `repos/${normalized.repository}/issues/comments/${existing.id}`,
    ]);
    return { action: "deleted", commentId: existing.id };
  }
  const body = renderCiFailureReport(normalized);
  const existing = [...trustedComments].reverse()[0];
  if (existing?.id) {
    requestJson(
      [
        "api",
        "--method",
        "PATCH",
        `repos/${normalized.repository}/issues/comments/${existing.id}`,
        "--input",
        "-",
      ],
      { input: JSON.stringify({ body }) }
    );
    return { action: "updated", commentId: existing.id };
  }
  const created = requestJson(
    [
      "api",
      "--method",
      "POST",
      `repos/${normalized.repository}/issues/${normalized.pullRequestNumber}/comments`,
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
  if (!report || report.headSha !== headSha || !reportHasFailureConclusion(report)) {
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

  const pr = env.SUPASCHEMA_FAKE_CI_INBOX_PR
    ? JSON.parse(env.SUPASCHEMA_FAKE_CI_INBOX_PR)
    : ghJson(["pr", "view", "--json", "number,headRefName,headRefOid,url,statusCheckRollup"], {
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
  const comments = env.SUPASCHEMA_FAKE_CI_INBOX_COMMENTS
    ? JSON.parse(env.SUPASCHEMA_FAKE_CI_INBOX_COMMENTS)
    : ghJson(["api", `repos/${repository}/issues/${pr.number}/comments?per_page=100`], {
        allowFailure: true,
        cwd: root,
      });
  if (Array.isArray(comments)) {
    for (const comment of [...trustedCiReportComments(comments)].reverse()) {
      const report = parseCiFailureReportComment(comment?.body);
      if (report?.headSha === headSha && reportHasFailureConclusion(report)) {
        return report;
      }
    }
  }
  return reportFromStatusCheckRollup({
    branch: pr.headRefName,
    headSha,
    pr,
    repository,
  });
}

function reportFromStatusCheckRollup({ branch, headSha, pr, repository }) {
  const jobs = failedStatusCheckJobs(pr?.statusCheckRollup);
  if (jobs.length === 0) {
    return;
  }
  const workflowRunId = workflowRunIdFromJobs(jobs);
  return normalizeReport({
    conclusion: "failure",
    headBranch: branch,
    headSha,
    jobs,
    pullRequestNumber: pr.number,
    reportedAt: new Date().toISOString(),
    repository,
    workflowName: "GitHub checks",
    workflowRunId,
    workflowRunUrl: workflowRunId ? actionsRunUrl(jobs) || pr.url : pr.url,
  });
}

function currentPullRequestHeadSha(report, requestJson) {
  const pr = requestJson(["api", `repos/${report.repository}/pulls/${report.pullRequestNumber}`], {
    allowFailure: true,
  });
  return String(pr?.head?.sha ?? "");
}

function trustedCiReportComments(comments) {
  return Array.isArray(comments) ? comments.filter(trustedCiReportComment) : [];
}

function trustedCiReportComment(comment) {
  if (!(typeof comment?.body === "string" && comment.body.includes(ciFailureMarker))) {
    return false;
  }
  return trustedReportAuthors.has(commentAuthorLogin(comment));
}

function commentAuthorLogin(comment) {
  return String(comment?.user?.login ?? comment?.author?.login ?? "");
}

function reportHasFailureConclusion(report) {
  return failureConclusions.has(String(report?.conclusion ?? "").toLowerCase());
}

function failedStatusCheckJobs(rollup) {
  const checks = Array.isArray(rollup) ? rollup : [];
  return checks
    .filter((item) => statusCheckFailed(item))
    .slice(0, maxJobs)
    .map((item, index) => ({
      annotations: [],
      conclusion: String(item?.conclusion ?? item?.state ?? "failure").toLowerCase(),
      id: item?.databaseId ?? item?.id ?? index,
      logExcerpt: [],
      name: String(item?.name ?? item?.context ?? item?.workflowName ?? "unknown check"),
      steps: [],
      url: String(item?.detailsUrl ?? item?.targetUrl ?? ""),
    }));
}

function statusCheckFailed(item) {
  const conclusion = String(item?.conclusion ?? item?.state ?? item?.status ?? "").toLowerCase();
  return (
    failureConclusions.has(conclusion) ||
    conclusion === "error" ||
    conclusion === "failed" ||
    conclusion === "failure"
  );
}

function workflowRunIdFromJobs(jobs) {
  for (const job of jobs) {
    const value = workflowRunIdFromUrl(job.url);
    if (value) {
      return value;
    }
  }
  return 0;
}

function workflowRunIdFromUrl(value) {
  const parts = String(value ?? "").split("/");
  const runsIndex = parts.indexOf("runs");
  if (runsIndex === -1) {
    return 0;
  }
  const id = Number(parts[runsIndex + 1]);
  return Number.isInteger(id) ? id : 0;
}

function actionsRunUrl(jobs) {
  const jobUrl = jobs.map((job) => job.url).find(Boolean);
  if (!jobUrl) {
    return "";
  }
  const parts = String(jobUrl).split("/");
  const runsIndex = parts.indexOf("runs");
  return runsIndex === -1 ? jobUrl : parts.slice(0, runsIndex + 2).join("/");
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
  if (report.jobs.length === 0) {
    lines.push("- Workflow concluded as failure, but no failed job details were available.");
  }
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
