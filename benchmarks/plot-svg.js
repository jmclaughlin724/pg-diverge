import {
  chip,
  defs,
  envFooter,
  fixtureScale,
  formatSeconds,
  groupedCorrectness,
  groupedStats,
  isSupaschema,
  passFailChip,
  percentile,
  svgFooter,
  svgHeader,
  text,
  theme,
  truncate,
} from "./plot-lib.js";

export function renderHeadToHeadSvg(rows, fixture, environments, options = {}) {
  const map = new Map();
  for (const row of rows) {
    const bucket = map.get(row.adapter) ?? { f1s: [], latencies: [], total: 0, twice: 0 };
    bucket.latencies.push(row.elapsedMs);
    if (typeof row.outputF1 === "number") {
      bucket.f1s.push(row.outputF1);
    }
    if (row.appliesTwice) {
      bucket.twice += 1;
    }
    bucket.total += 1;
    map.set(row.adapter, bucket);
  }
  const groups = [...map.entries()]
    .map(([label, b]) => ({
      f1:
        b.f1s.length > 0 ? b.f1s.reduce((sum, value) => sum + value, 0) / b.f1s.length : undefined,
      label,
      median: percentile(b.latencies, 0.5),
      p95: percentile(b.latencies, 0.95),
      total: b.total,
      twice: b.twice,
    }))
    .sort((a, b) => a.median - b.median || a.label.localeCompare(b.label));

  const width = 1000;
  const margin = 36;
  const labelX = margin;
  const x0 = 232;
  const chartWidth = 400;
  const f1ColX = 700;
  const replayColX = 845;
  const headerBottom = 118;
  const top = headerBottom + 32;
  const rowHeight = 50;
  const plotBottom = top + groups.length * rowHeight - 12;
  const height = plotBottom + 76;

  const domainMax = Math.max(...groups.map((group) => group.p95)) * 1.04;
  const xFor = (value) => x0 + (Math.max(0, value) / domainMax) * chartWidth;
  const tablesNote = fixtureScale[fixture]?.tables;
  const supaMedians = groups.filter((g) => isSupaschema(g.label)).map((g) => g.median);
  const engineMedians = groups.filter((g) => !isSupaschema(g.label)).map((g) => g.median);
  const slowestSupa = supaMedians.length > 0 ? Math.max(...supaMedians) : undefined;
  const speedup =
    slowestSupa !== undefined && engineMedians.length > 0
      ? Math.floor(Math.max(...engineMedians) / slowestSupa)
      : 0;

  const title =
    options.title ??
    `supaschema vs every Supabase CLI engine${tablesNote ? ` — ${tablesNote}` : ""}`;
  const subtitleSource =
    options.subtitle ??
    "Median diff latency (linear, lower is better) · accuracy F1 vs ground truth · replay-safe = migration applies twice";
  const subtitleLines = splitSubtitle(subtitleSource, 96);

  const parts = [
    svgHeader(width, height),
    defs(),
    `<rect width="100%" height="100%" rx="14" fill="${theme.bg}" />`,
    text(labelX, 52, title, { fill: theme.title, size: 22, weight: "700" }),
  ];
  for (const [index, line] of subtitleLines.entries()) {
    parts.push(text(labelX, 80 + index * 19, line, { fill: theme.subtitle, size: 12.5 }));
  }
  if (speedup >= 2) {
    parts.push(speedupChip(width - margin, `up to ${speedup}× faster`, 16.5));
  }

  for (const [header, columnX, anchor] of [
    [options.latencyHeader ?? "median diff", x0, "start"],
    ["accuracy (F1)", f1ColX + 60, "middle"],
    ["replay-safe", replayColX + 60, "middle"],
  ]) {
    parts.push(
      text(columnX, top - 18, header, { anchor, fill: theme.muted, size: 11.5, weight: "600" }),
    );
  }

  const tickStep = domainMax <= 10_000 ? 2000 : domainMax <= 60_000 ? 10_000 : 50_000;
  for (let tickValue = 0; tickValue <= domainMax + 1; tickValue += tickStep) {
    const tickX = xFor(tickValue);
    parts.push(
      `<line x1="${tickX.toFixed(1)}" y1="${top - 8}" x2="${tickX.toFixed(1)}" y2="${plotBottom}" stroke="${theme.grid}" stroke-width="1" />`,
      text(tickX, plotBottom + 22, formatSeconds(tickValue), {
        anchor: "middle",
        fill: theme.muted,
        size: 11,
      }),
    );
  }

  for (const [index, group] of groups.entries()) {
    const y = top + index * rowHeight;
    const supa = isSupaschema(group.label);
    const barFill = supa ? "url(#supaGradient)" : "url(#slateGradient)";
    const barEnd = xFor(group.median);
    const p95X = xFor(group.p95);
    if (supa) {
      parts.push(`<circle cx="${labelX + 5}" cy="${y + 11}" r="4" fill="${theme.accent}" />`);
    }
    const ratio = slowestSupa !== undefined && !supa ? group.median / slowestSupa : undefined;
    const valueLabel =
      ratio !== undefined && ratio >= 2
        ? `${formatSeconds(group.median)} · ${Math.floor(ratio)}× slower`
        : formatSeconds(group.median);
    const insideBar = !supa && barEnd - x0 > 150;
    parts.push(
      text(labelX + 18, y + 15, truncate(group.label, 22), {
        fill: supa ? theme.title : theme.text,
        size: 13,
        weight: supa ? "650" : "450",
      }),
      `<rect x="${x0}" y="${y}" width="${Math.max(3, barEnd - x0).toFixed(1)}" height="20" rx="5" fill="${barFill}" />`,
      `<line x1="${barEnd.toFixed(1)}" y1="${y + 10}" x2="${p95X.toFixed(1)}" y2="${y + 10}" stroke="${theme.title}" stroke-opacity="0.18" stroke-width="1.5" />`,
      `<line x1="${p95X.toFixed(1)}" y1="${y - 3}" x2="${p95X.toFixed(1)}" y2="${y + 23}" stroke="${theme.title}" stroke-opacity="0.45" stroke-width="2" />`,
      insideBar
        ? text(barEnd - 8, y + 14.5, valueLabel, {
            anchor: "end",
            fill: theme.title,
            size: 12,
            weight: "600",
          })
        : text(Math.max(barEnd, p95X) + 8, y + 15, valueLabel, {
            fill: supa ? theme.accent : theme.subtitle,
            size: 12,
            weight: supa ? "700" : "500",
          }),
    );
    if (group.f1 === undefined) {
      parts.push(chip(f1ColX, y - 2, "—", "muted"));
    } else {
      parts.push(chip(f1ColX, y - 2, group.f1.toFixed(3), group.f1 >= 0.9995 ? "pass" : "warn"));
    }
    parts.push(passFailChip(replayColX, y - 2, group.twice, group.total));
  }

  parts.push(
    text(labelX, height - 22, envFooter(environments, fixture), { fill: theme.muted, size: 11 }),
    svgFooter(),
  );
  return parts.join("\n");
}

function speedupChip(rightEdge, label, size) {
  const chipWidth = Math.max(170, Math.round(label.length * size * 0.52) + 34);
  const chipX = rightEdge - chipWidth;
  return [
    `<rect x="${chipX}" y="30" width="${chipWidth}" height="40" rx="10" fill="rgba(16,185,129,0.12)" stroke="${theme.passStroke}" stroke-opacity="0.55" />`,
    text(chipX + chipWidth / 2, 56, label, {
      anchor: "middle",
      fill: theme.accent,
      size,
      weight: "700",
    }),
  ].join("\n");
}

function splitSubtitle(subtitle, maxChars) {
  if (subtitle.length <= maxChars) {
    return [subtitle];
  }
  const segments = subtitle.split(" · ");
  const lines = [];
  let current = "";
  for (const segment of segments) {
    const candidate = current.length > 0 ? `${current} · ${segment}` : segment;
    if (candidate.length > maxChars && current.length > 0) {
      lines.push(current);
      current = segment;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.slice(0, 2);
}

export function renderLatencySvg(rows, fixture, environments) {
  const groups = groupedStats(rows);
  const width = 1000;
  const margin = 36;
  const labelX = margin;
  const x0 = 232;
  const chartWidth = width - margin - x0;
  const rowHeight = 44;
  const top = 130;
  const plotBottom = top + groups.length * rowHeight - 12;
  const height = plotBottom + 76;
  const domainMax = Math.max(...groups.map((group) => group.p95)) * 1.04;
  const xFor = (value) => x0 + (Math.max(0, value) / domainMax) * chartWidth;
  const tablesNote = fixtureScale[fixture]?.tables;
  const supaMedians = groups.filter((g) => isSupaschema(g.label)).map((g) => g.median);
  const engineMedians = groups.filter((g) => !isSupaschema(g.label)).map((g) => g.median);
  const slowestSupa = supaMedians.length > 0 ? Math.max(...supaMedians) : undefined;
  const speedup =
    slowestSupa !== undefined && engineMedians.length > 0
      ? Math.floor(Math.max(...engineMedians) / slowestSupa)
      : 0;
  const title = tablesNote
    ? tablesNote.replace(/\btables?\b/u, (word) => (word === "table" ? "Table" : "Tables"))
    : `${fixture} fixture`;
  const parts = [
    svgHeader(width, height),
    defs(),
    `<rect width="100%" height="100%" rx="14" fill="${theme.bg}" />`,
    text(labelX, 52, title, { fill: theme.title, size: 22, weight: "700" }),
    text(
      labelX,
      80,
      `${fixture} fixture · median diff seconds (linear, lower is better) · whisker marks p95`,
      { fill: theme.subtitle, size: 12.5 },
    ),
  ];
  if (speedup >= 2) {
    parts.push(
      speedupChip(
        width - margin,
        `supaschema is up to ${speedup}× faster than legacy diff engines`,
        15,
      ),
    );
  }
  const tickStep = domainMax <= 10_000 ? 2000 : domainMax <= 60_000 ? 10_000 : 50_000;
  for (let tickValue = 0; tickValue <= domainMax + 1; tickValue += tickStep) {
    const tickX = xFor(tickValue);
    parts.push(
      `<line x1="${tickX.toFixed(1)}" y1="${top - 8}" x2="${tickX.toFixed(1)}" y2="${plotBottom}" stroke="${theme.grid}" stroke-width="1" />`,
      text(tickX, plotBottom + 22, formatSeconds(tickValue), {
        anchor: "middle",
        fill: theme.muted,
        size: 11,
      }),
    );
  }
  for (const [index, group] of groups.entries()) {
    const y = top + index * rowHeight;
    const supa = isSupaschema(group.label);
    const barFill = supa ? "url(#supaGradient)" : "url(#slateGradient)";
    const barEnd = xFor(group.median);
    const p95X = xFor(group.p95);
    if (supa) {
      parts.push(`<circle cx="${labelX + 5}" cy="${y + 11}" r="4" fill="${theme.accent}" />`);
    }
    const ratio = slowestSupa !== undefined && !supa ? group.median / slowestSupa : undefined;
    const valueLabel =
      ratio !== undefined && ratio >= 2
        ? `${formatSeconds(group.median)} · ${Math.floor(ratio)}× slower`
        : formatSeconds(group.median);
    const insideBar = !supa && barEnd - x0 > 150;
    parts.push(
      text(labelX + 18, y + 15, truncate(group.label, 22), {
        fill: supa ? theme.title : theme.text,
        size: 13,
        weight: supa ? "650" : "450",
      }),
      `<rect x="${x0}" y="${y}" width="${Math.max(3, barEnd - x0).toFixed(1)}" height="20" rx="5" fill="${barFill}" />`,
      `<line x1="${barEnd.toFixed(1)}" y1="${y + 10}" x2="${p95X.toFixed(1)}" y2="${y + 10}" stroke="${theme.title}" stroke-opacity="0.18" stroke-width="1.5" />`,
      `<line x1="${p95X.toFixed(1)}" y1="${y - 3}" x2="${p95X.toFixed(1)}" y2="${y + 23}" stroke="${theme.title}" stroke-opacity="0.45" stroke-width="2" />`,
      insideBar
        ? text(barEnd - 8, y + 14.5, valueLabel, {
            anchor: "end",
            fill: theme.title,
            size: 12,
            weight: "600",
          })
        : text(Math.max(barEnd, p95X) + 8, y + 15, valueLabel, {
            fill: supa ? theme.accent : theme.subtitle,
            size: 12,
            weight: supa ? "700" : "500",
          }),
    );
  }
  parts.push(
    text(labelX, height - 22, envFooter(environments, fixture), { fill: theme.muted, size: 11 }),
    svgFooter(),
  );
  return parts.join("\n");
}

export function renderCorrectnessSvg(rows, fixture, environments) {
  const groups = groupedCorrectness(rows);
  const width = 1200;
  const rowHeight = 38;
  const labelX = 36;
  const top = 132;
  const height = top + groups.length * rowHeight + 56;
  const columns = [
    { key: "once", label: "applies once", x: 430 },
    { key: "twice", label: "applies twice", x: 610 },
    { key: "match", label: "matches target", x: 790 },
    { key: "f1", label: "output F1", x: 985 },
  ];
  const tablesNote = fixtureScale[fixture]?.tables;
  const parts = [
    svgHeader(width, height),
    defs(),
    `<rect width="100%" height="100%" rx="14" fill="${theme.bg}" />`,
    text(
      labelX,
      46,
      `Verification & accuracy — ${fixture} fixture${tablesNote ? ` (${tablesNote})` : ""}`,
      { fill: theme.title, size: 21, weight: "700" },
    ),
    text(
      labelX,
      70,
      "Each generated migration is applied in one transaction, applied again, and the catalog is fingerprinted against the target.",
      { fill: theme.subtitle, size: 12.5 },
    ),
    text(
      labelX,
      88,
      "Output F1 scores generated SQL content against the fixture's ground-truth change manifest (1.000 = exact).",
      { fill: theme.subtitle, size: 12.5 },
    ),
  ];
  for (const column of columns) {
    parts.push(
      text(column.x + 60, top - 16, column.label, {
        anchor: "middle",
        fill: theme.muted,
        size: 11.5,
        weight: "600",
      }),
    );
  }
  for (const [index, group] of groups.entries()) {
    const y = top + index * rowHeight;
    const supa = isSupaschema(group.label);
    if (supa) {
      parts.push(`<circle cx="${labelX + 5}" cy="${y + 11}" r="4" fill="${theme.accent}" />`);
    }
    parts.push(
      text(labelX + 18, y + 15, truncate(group.label, 30), {
        fill: supa ? theme.title : theme.text,
        size: 13,
        weight: supa ? "650" : "450",
      }),
    );
    if (group.total === 0) {
      parts.push(chip(columns[0].x, y, "skipped", "muted"));
      continue;
    }
    parts.push(passFailChip(columns[0].x, y, group.once, group.total));
    parts.push(passFailChip(columns[1].x, y, group.twice, group.total));
    parts.push(passFailChip(columns[2].x, y, group.match, group.total));
    if (group.f1 === undefined) {
      parts.push(chip(columns[3].x, y, "—", "muted"));
    } else {
      parts.push(chip(columns[3].x, y, group.f1.toFixed(3), group.f1 >= 0.9995 ? "pass" : "warn"));
    }
  }
  parts.push(
    text(labelX, height - 22, envFooter(environments, fixture), { fill: theme.muted, size: 11 }),
    svgFooter(),
  );
  return parts.join("\n");
}
