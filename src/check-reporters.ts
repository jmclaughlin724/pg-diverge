import type { Diagnostic } from "./core.js";
import { formatDiagnostics } from "./diagnostics.js";

export type CheckReporter = "text" | "github" | "sarif" | "json";

export interface FileDiagnostics {
  diagnostics: Diagnostic[];
  file: string;
}

export function renderCheckReport(reporter: CheckReporter, files: FileDiagnostics[]): string {
  switch (reporter) {
    case "github":
      return renderGithub(files);
    case "sarif":
      return renderSarif(files);
    case "json":
      return `${JSON.stringify(
        files.map((entry) => ({ diagnostics: entry.diagnostics, file: entry.file })),
        null,
        2,
      )}\n`;
    default:
      return renderText(files);
  }
}

function renderText(files: FileDiagnostics[]): string {
  const lines: string[] = [];
  for (const entry of files) {
    if (entry.diagnostics.length === 0) {
      continue;
    }
    if (files.length > 1) {
      lines.push(`${entry.file}:`);
    }
    lines.push(formatDiagnostics(entry.diagnostics));
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function renderGithub(files: FileDiagnostics[]): string {
  const lines: string[] = [];
  for (const entry of files) {
    for (const item of entry.diagnostics) {
      const level = item.severity === "error" ? "error" : "warning";
      const message = escapeGithubData(
        `${item.code}: ${item.message}${item.hint ? ` (${item.hint})` : ""}`,
      );
      lines.push(
        `::${level} file=${escapeGithubProperty(entry.file)},title=${item.code}::${message}`,
      );
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function renderSarif(files: FileDiagnostics[]): string {
  const results = files.flatMap((entry) =>
    entry.diagnostics.map((item) => ({
      level: item.severity === "error" ? "error" : "warning",
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: entry.file },
          },
        },
      ],
      message: { text: `${item.message}${item.hint ? ` (${item.hint})` : ""}` },
      ruleId: item.code,
    })),
  );
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        results,
        tool: {
          driver: {
            informationUri: "https://github.com/jmclaughlin724/pg-diverge",
            name: "pg-diverge",
            rules: [...new Set(results.map((result) => result.ruleId))].map((code) => ({
              id: code,
            })),
          },
        },
      },
    ],
    version: "2.1.0",
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

function escapeGithubData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeGithubProperty(value: string): string {
  return escapeGithubData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
