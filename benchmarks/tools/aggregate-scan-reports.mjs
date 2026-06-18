#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { aggregateOptInScanReports } from "../../dist/scan.js";

const args = process.argv.slice(2);

try {
  const options = parseArgs(args);
  const reports = [];
  for (const file of options.inputs) {
    const payload = JSON.parse(await readFile(file, "utf8"));
    if (!isScanJsonReport(payload)) {
      throw new Error(`${file} is not a scan JSON report`);
    }
    reports.push(payload);
  }
  const aggregate = aggregateOptInScanReports(reports, options.generatedAt);
  const output = `${JSON.stringify(aggregate, null, 2)}\n`;
  if (options.out === undefined) {
    process.stdout.write(output);
  } else {
    await writeFile(options.out, output, "utf8");
    process.stdout.write(`${options.out}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

function parseArgs(values) {
  const inputs = [];
  let generatedAt = new Date().toISOString();
  let out;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--generated-at") {
      generatedAt = readOptionValue(values, index, value);
      index += 1;
    } else if (value === "--out") {
      out = readOptionValue(values, index, value);
      index += 1;
    } else if (value.startsWith("--")) {
      throw new Error(`unknown option ${value}`);
    } else {
      inputs.push(value);
    }
  }
  if (inputs.length === 0) {
    throw new Error("provide at least one scan JSON report");
  }
  return { generatedAt, inputs, out };
}

function readOptionValue(values, index, option) {
  const value = values[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function isScanJsonReport(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    typeof value.file === "string" &&
    typeof value.score === "number" &&
    typeof value.errorCount === "number" &&
    typeof value.warningCount === "number" &&
    isGrade(value.grade) &&
    Array.isArray(value.diagnostics)
  );
}

function isGrade(value) {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F";
}
