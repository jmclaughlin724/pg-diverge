#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanJsonReport } from "./model.js";
import { aggregateOptInScanReports, isScanJsonReport } from "./model.js";

export interface ScanAggregateInputOptions {
  generatedAt: string;
  inputs: string[];
}

export interface ScanAggregateCliOptions extends ScanAggregateInputOptions {
  out?: string;
}

export async function aggregateScanReportFiles(
  options: ScanAggregateInputOptions
): Promise<string> {
  const reports: ScanJsonReport[] = [];
  for (const file of options.inputs) {
    const payload = JSON.parse(await readFile(file, "utf8"));
    if (!isScanJsonReport(payload)) {
      throw new Error(`${file} is not a scan JSON report`);
    }
    reports.push(payload);
  }
  return `${JSON.stringify(aggregateOptInScanReports(reports, options.generatedAt), null, 2)}\n`;
}

export function parseScanAggregateArgs(values: readonly string[]): ScanAggregateCliOptions {
  const inputs: string[] = [];
  let generatedAt = new Date().toISOString();
  let out: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--generated-at") {
      generatedAt = readOptionValue(values, index, value);
      index += 1;
    } else if (value === "--out") {
      out = readOptionValue(values, index, value);
      index += 1;
    } else if (value?.startsWith("--")) {
      throw new Error(`unknown option ${value}`);
    } else if (value !== undefined) {
      inputs.push(value);
    }
  }
  if (inputs.length === 0) {
    throw new Error("provide at least one scan JSON report");
  }
  return out === undefined ? { generatedAt, inputs } : { generatedAt, inputs, out };
}

export async function runScanAggregateCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseScanAggregateArgs(args);
  const output = await aggregateScanReportFiles(options);
  if (options.out === undefined) {
    process.stdout.write(output);
    return;
  }
  await writeFile(options.out, output, "utf8");
  process.stdout.write(`${options.out}\n`);
}

function readOptionValue(values: readonly string[], index: number, option: string): string {
  const value = values[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isMainModule()) {
  try {
    await runScanAggregateCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
