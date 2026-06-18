#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fixtureScale, theme } from "./plot-lib.js";
import { renderHeadToHeadSvg } from "./plot-svg.js";

const workflowSuffix = "-workflow";
const args = process.argv.slice(2);
const barsOnly = args.includes("--bars-only");
const workflow = args.includes("--workflow");
const positional = args.filter((arg) => arg !== "--bars-only" && arg !== "--workflow");
const input = resolve(positional[0] ?? "benchmarks/results/comparison-xl.json");
const output = resolve(positional[1] ?? defaultOutputPath());
const payload = JSON.parse(await readFile(input, "utf8"));
const fixtures = [...new Set(payload.results.map((item) => item.fixture))];
const fixture = fixtures[0];
const environments = [
  {
    arch: payload.environment.arch,
    completedAt: payload.completedAt,
    fixtures,
    iterations: payload.environment.iterations,
    node: payload.environment.node,
    platform: payload.environment.platform,
    source: basename(input),
    toolVersions: payload.environment.toolVersions,
  },
];
const rows = payload.results
  .filter(
    (item) =>
      item.fixture === fixture &&
      !item.skipped &&
      !item.unsupported &&
      item.adapter.endsWith(workflowSuffix) === workflow
  )
  .map((item) =>
    workflow ? { ...item, adapter: item.adapter.slice(0, -workflowSuffix.length) } : item
  );
const tablesNote = fixtureScale[fixture]?.tables;
const options = chartOptions();
await writeFile(output, renderHeadToHeadSvg(rows, fixture, environments, options), "utf8");
process.stdout.write(`${output}\n`);

function defaultOutputPath() {
  if (barsOnly) {
    return "docs/benchmarks/head-to-head-xl-bars.svg";
  }
  if (workflow) {
    return "docs/benchmarks/head-to-head-workflow-xl.svg";
  }
  return "docs/benchmarks/head-to-head-xl.svg";
}

function chartOptions() {
  if (barsOnly) {
    return {
      ...readableHeadToHeadOptions(),
      showMetricColumns: false,
      subtitle: "Median diff latency (linear, lower is better)",
    };
  }
  if (workflow) {
    return {
      ...readableHeadToHeadOptions(),
      latencyHeader: "median workflow",
      subtitle:
        "Median full-workflow latency: migration + regenerated types in one command vs db diff + apply + gen types · F1 vs ground truth · replay-safe = migration applies twice",
      title: "full workflow vs diff engines",
    };
  }
  return readableHeadToHeadOptions();
}

function readableHeadToHeadOptions() {
  return {
    badgeText: tablesNote,
    barHeight: 30,
    barRadius: 7,
    headerSize: 16,
    rowHeight: 62,
    rowLabelSize: 17,
    showSpeedup: false,
    subtitleMaxChars: 72,
    subtitleSize: 14.5,
    tickFill: theme.title,
    tickSize: 16,
    title: "supaschema vs diff engines",
    titleSize: 34,
    valueLabelSize: 17,
  };
}
