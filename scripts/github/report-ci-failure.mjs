#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { reportFromWorkflowRunEvent, upsertCiFailureComment } from "./ci-inbox-core.mjs";

const eventPath = process.env.GITHUB_EVENT_PATH;
const event = eventPath ? JSON.parse(readFileSync(eventPath, "utf8")) : {};
const report = reportFromWorkflowRunEvent(event);

if (!report) {
  process.stdout.write("CI_FAILURE_REPORT_SKIPPED\n");
  process.exit(0);
}

const result = upsertCiFailureComment(report);
process.stdout.write(
  `CI_FAILURE_REPORT_OK action=${result.action} pr=${report.pullRequestNumber} run=${report.workflowRunId}\n`
);
