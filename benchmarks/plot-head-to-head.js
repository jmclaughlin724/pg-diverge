#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fixtureScale } from "./plot-lib.js";
import { renderHeadToHeadSvg } from "./plot-svg.js";

const args = process.argv.slice(2);
const workflow = args.includes("--workflow");
const positional = args.filter((arg) => arg !== "--workflow");
const input = resolve(positional[0] ?? "benchmarks/results/comparison-xl.json");
const output = resolve(
  positional[1] ??
    (workflow
      ? "docs/benchmarks/head-to-head-workflow-xl.svg"
      : "docs/benchmarks/head-to-head-xl.svg"),
);
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
      item.adapter.endsWith("-workflow") === workflow,
  )
  .map((item) => (workflow ? { ...item, adapter: item.adapter.replace(/-workflow$/, "") } : item));
const tablesNote = fixtureScale[fixture]?.tables;
const options = workflow
  ? {
      latencyHeader: "median workflow",
      subtitle:
        "Median full-workflow latency: migration + regenerated types in one command vs db diff + apply + gen types · F1 vs ground truth · replay-safe = migration applies twice",
      title: `Full workflow, head to head${tablesNote ? ` — ${tablesNote}` : ""}`,
    }
  : {};
await writeFile(output, renderHeadToHeadSvg(rows, fixture, environments, options), "utf8");
process.stdout.write(`${output}\n`);
