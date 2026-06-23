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

function tickStepFor(domainMax) {
  if (domainMax <= 10_000) {
    return 2000;
  }
  if (domainMax <= 60_000) {
    return 10_000;
  }
  return 50_000;
}

function headToHeadGroups(rows) {
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
  return [...map.entries()]
    .map(([label, bucket]) => ({
      f1: average(bucket.f1s),
      label,
      median: percentile(bucket.latencies, 0.5),
      p95: percentile(bucket.latencies, 0.95),
      total: bucket.total,
      twice: bucket.twice,
    }))
    .sort((a, b) => a.median - b.median || a.label.localeCompare(b.label));
}

function average(values) {
  if (values.length === 0) {
    return;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latencyMetrics(groups) {
  const domainMax = Math.max(...groups.map((group) => group.p95)) * 1.04;
  const supaMedians = groups
    .filter((group) => isSupaschema(group.label))
    .map((group) => group.median);
  const engineMedians = groups
    .filter((group) => !isSupaschema(group.label))
    .map((group) => group.median);
  const slowestSupa = supaMedians.length > 0 ? Math.max(...supaMedians) : undefined;
  const speedup =
    slowestSupa !== undefined && engineMedians.length > 0
      ? Math.floor(Math.max(...engineMedians) / slowestSupa)
      : 0;
  return { domainMax, slowestSupa, speedup };
}

function pushTickGrid(
  parts,
  { domainMax, plotBottom, tickFill = theme.muted, tickSize = 11, top, xFor }
) {
  const tickStep = tickStepFor(domainMax);
  for (let tickValue = 0; tickValue <= domainMax + 1; tickValue += tickStep) {
    const tickX = xFor(tickValue);
    parts.push(
      `<line stroke="${theme.grid}" stroke-width="1" x1="${tickX.toFixed(1)}" x2="${tickX.toFixed(1)}" y1="${top - 8}" y2="${plotBottom}" />`,
      text(tickX, plotBottom + 22, formatSeconds(tickValue), {
        anchor: "middle",
        fill: tickFill,
        size: tickSize,
      })
    );
  }
}

function latencyValueLabel(group, slowestSupa, supa) {
  const ratio = slowestSupa !== undefined && !supa ? group.median / slowestSupa : undefined;
  if (ratio !== undefined && ratio >= 2) {
    return `${formatSeconds(group.median)} · ${Math.floor(ratio)}× slower`;
  }
  return formatSeconds(group.median);
}

function pushLatencyRow(parts, group, options) {
  const {
    barHeight = 20,
    barRadius = 5,
    labelX,
    rowLabelSize = 13,
    slowestSupa,
    valueLabelSize = 12,
    x0,
    xFor,
    y,
  } = options;
  const supa = isSupaschema(group.label);
  const barEnd = xFor(group.median);
  const p95X = xFor(group.p95);
  const barCenter = y + barHeight / 2;
  const rowTextBaseline = barCenter + rowLabelSize * 0.36;
  const valueTextBaseline = barCenter + valueLabelSize * 0.36;
  if (supa) {
    parts.push(`<circle cx="${labelX + 5}" cy="${barCenter}" fill="${theme.accent}" r="4" />`);
  }
  const valueLabel = latencyValueLabel(group, slowestSupa, supa);
  const insideBar = !supa && barEnd - x0 > 150;
  parts.push(
    text(labelX + 18, rowTextBaseline, truncate(group.label, 22), {
      fill: supa ? theme.title : theme.text,
      size: rowLabelSize,
      weight: supa ? "650" : "450",
    }),
    `<rect fill="${supa ? "url(#supaGradient)" : "url(#slateGradient)"}" height="${barHeight}" rx="${barRadius}" width="${Math.max(3, barEnd - x0).toFixed(1)}" x="${x0}" y="${y}" />`,
    `<line stroke="${theme.title}" stroke-opacity="0.18" stroke-width="1.5" x1="${barEnd.toFixed(1)}" x2="${p95X.toFixed(1)}" y1="${barCenter}" y2="${barCenter}" />`,
    `<line stroke="${theme.title}" stroke-opacity="0.45" stroke-width="2" x1="${p95X.toFixed(1)}" x2="${p95X.toFixed(1)}" y1="${y - 3}" y2="${y + barHeight + 3}" />`,
    latencyLabelText({
      barEnd,
      insideBar,
      p95X,
      supa,
      valueLabel,
      valueLabelSize,
      valueTextBaseline,
    })
  );
}

function latencyLabelText({
  barEnd,
  insideBar,
  p95X,
  supa,
  valueLabel,
  valueLabelSize,
  valueTextBaseline,
}) {
  if (insideBar) {
    return text(barEnd - 8, valueTextBaseline, valueLabel, {
      anchor: "end",
      fill: theme.title,
      size: valueLabelSize,
      weight: "600",
    });
  }
  return text(Math.max(barEnd, p95X) + 8, valueTextBaseline, valueLabel, {
    fill: supa ? theme.accent : theme.subtitle,
    size: valueLabelSize,
    weight: supa ? "700" : "500",
  });
}

function pushHeadToHeadCells(parts, group, { f1ColX, replayColX, y }) {
  if (group.f1 === undefined) {
    parts.push(chip(f1ColX, y - 2, "—", "muted"));
  } else {
    parts.push(chip(f1ColX, y - 2, group.f1.toFixed(3), group.f1 >= 0.9995 ? "pass" : "warn"));
  }
  parts.push(passFailChip(replayColX, y - 2, group.twice, group.total));
}

function headToHeadLayout(groups, options) {
  const showMetricColumns = options.showMetricColumns !== false;
  const width = 1000;
  const margin = 36;
  const x0 = 232;
  const headerBottom = 118;
  const top = headerBottom + 32;
  const rowHeight = options.rowHeight ?? 50;
  const plotBottom = top + groups.length * rowHeight - 12;
  return {
    barHeight: options.barHeight ?? 20,
    barRadius: options.barRadius ?? 5,
    chartWidth: showMetricColumns ? 400 : width - margin - x0,
    f1ColX: 700,
    headerSize: options.headerSize ?? 11.5,
    height: plotBottom + 76,
    labelX: margin,
    margin,
    plotBottom,
    replayColX: 845,
    rowHeight,
    rowLabelSize: options.rowLabelSize ?? 13,
    showMetricColumns,
    showSpeedup: options.showSpeedup !== false,
    subtitleSize: options.subtitleSize ?? 12.5,
    tickFill: options.tickFill ?? theme.muted,
    tickSize: options.tickSize ?? 11,
    titleSize: options.titleSize ?? 22,
    top,
    valueLabelSize: options.valueLabelSize ?? 12,
    width,
    x0,
  };
}

function headToHeadHeaders(layout, options) {
  if (!layout.showMetricColumns) {
    return [[options.latencyHeader ?? "median diff", layout.x0, "start"]];
  }
  return [
    [options.latencyHeader ?? "median diff", layout.x0, "start"],
    ["accuracy (F1)", layout.f1ColX + 60, "middle"],
    ["replay-safe", layout.replayColX + 60, "middle"],
  ];
}

function pushHeadToHeadIntro(parts, layout, title, subtitleLines, speedup, options) {
  parts.push(
    svgHeader(layout.width, layout.height, title),
    defs(),
    `<rect fill="${theme.bg}" height="100%" rx="14" width="100%" />`,
    text(layout.labelX, 52, title, { fill: theme.title, size: layout.titleSize, weight: "700" })
  );
  if (options.badgeText) {
    parts.push(
      tableCountBadge(layout.width - layout.margin, options.badgeText, options.badgeSize ?? 18)
    );
  }
  for (const [index, line] of subtitleLines.entries()) {
    parts.push(
      text(layout.labelX, 84 + index * 18, line, {
        fill: theme.subtitle,
        size: layout.subtitleSize,
      })
    );
  }
  if (layout.showSpeedup && speedup >= 2) {
    parts.push(speedupChip(layout.width - layout.margin, `up to ${speedup}× faster`, 16.5));
  }
}

function pushHeadToHeadHeaders(parts, layout, options) {
  for (const [header, columnX, anchor] of headToHeadHeaders(layout, options)) {
    parts.push(
      text(columnX, layout.top - 18, header, {
        anchor,
        fill: theme.muted,
        size: layout.headerSize,
        weight: "600",
      })
    );
  }
}

function pushHeadToHeadRows(parts, groups, layout, slowestSupa, xFor) {
  for (const [index, group] of groups.entries()) {
    const y = layout.top + index * layout.rowHeight;
    pushLatencyRow(parts, group, {
      barHeight: layout.barHeight,
      barRadius: layout.barRadius,
      labelX: layout.labelX,
      rowLabelSize: layout.rowLabelSize,
      slowestSupa,
      valueLabelSize: layout.valueLabelSize,
      x0: layout.x0,
      xFor,
      y,
    });
    if (layout.showMetricColumns) {
      pushHeadToHeadCells(parts, group, {
        f1ColX: layout.f1ColX,
        replayColX: layout.replayColX,
        y,
      });
    }
  }
}

export function renderHeadToHeadSvg(rows, fixture, environments, options = {}) {
  const groups = headToHeadGroups(rows);
  const layout = headToHeadLayout(groups, options);
  const badgeText = options.badgeText;
  const subtitleMaxChars = options.subtitleMaxChars ?? (badgeText ? 72 : 96);

  const { domainMax, slowestSupa, speedup } = latencyMetrics(groups);
  const xFor = (value) => layout.x0 + (Math.max(0, value) / domainMax) * layout.chartWidth;

  const title = options.title ?? "supaschema vs diff engines";
  const subtitleSource =
    options.subtitle ??
    (layout.showMetricColumns
      ? "Median diff latency (linear, lower is better) · accuracy F1 vs ground truth · replay-safe = migration applies twice"
      : "Median diff latency (linear, lower is better)");
  const subtitleLines = splitSubtitle(subtitleSource, subtitleMaxChars);

  const parts = [];
  pushHeadToHeadIntro(parts, layout, title, subtitleLines, speedup, options);
  pushHeadToHeadHeaders(parts, layout, options);
  pushTickGrid(parts, {
    domainMax,
    plotBottom: layout.plotBottom,
    tickFill: layout.tickFill,
    tickSize: layout.tickSize,
    top: layout.top,
    xFor,
  });
  pushHeadToHeadRows(parts, groups, layout, slowestSupa, xFor);

  parts.push(
    text(layout.labelX, layout.height - 22, envFooter(environments, fixture), {
      fill: theme.muted,
      size: 11,
    }),
    svgFooter()
  );
  return parts.join("\n");
}

function tableCountBadge(rightEdge, label, size) {
  const badgeWidth = Math.max(176, Math.round(label.length * size * 0.56) + 38);
  const badgeX = rightEdge - badgeWidth;
  return [
    `<rect fill="${theme.accent}" height="42" rx="11" stroke="${theme.accentDeep}" stroke-opacity="0.7" width="${badgeWidth}" x="${badgeX}" y="29" />`,
    text(badgeX + badgeWidth / 2, 56.5, label, {
      anchor: "middle",
      fill: theme.bg,
      size,
      weight: "800",
    }),
  ].join("\n");
}

function speedupChip(rightEdge, label, size) {
  const chipWidth = Math.max(170, Math.round(label.length * size * 0.52) + 34);
  const chipX = rightEdge - chipWidth;
  return [
    `<rect fill="${theme.passFill}" height="40" rx="10" stroke="${theme.passStroke}" stroke-opacity="0.55" width="${chipWidth}" x="${chipX}" y="30" />`,
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
  const lines = [];
  let current = "";
  for (const word of splitWhitespace(subtitle)) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.slice(0, 3);
}

function splitWhitespace(value) {
  const words = [];
  let current = "";
  for (const char of value) {
    if (isWhitespace(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words;
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "\f";
}

export function renderLatencySvg(rows, fixture, environments) {
  const groups = groupedStats(rows);
  const width = 1000;
  const margin = 36;
  const labelX = margin;
  const x0 = 232;
  const chartWidth = width - margin - x0;
  const rowHeight = 62;
  const top = 150;
  const plotBottom = top + groups.length * rowHeight - 12;
  const height = plotBottom + 76;
  const { domainMax, slowestSupa, speedup } = latencyMetrics(groups);
  const xFor = (value) => x0 + (Math.max(0, value) / domainMax) * chartWidth;
  const tablesNote = fixtureScale[fixture]?.tables;
  const title = "supaschema vs diff engines";
  const subtitleLines = splitSubtitle(
    `${fixture} fixture · median diff latency (linear, lower is better) · whisker marks p95`,
    72
  );
  const parts = [
    svgHeader(width, height, title),
    defs(),
    `<rect fill="${theme.bg}" height="100%" rx="14" width="100%" />`,
    text(labelX, 52, title, { fill: theme.title, size: 34, weight: "700" }),
    tableCountBadge(width - margin, tablesNote ?? `${fixture} fixture`, 18),
  ];
  for (const [index, line] of subtitleLines.entries()) {
    parts.push(text(labelX, 84 + index * 18, line, { fill: theme.subtitle, size: 14.5 }));
  }
  if (speedup >= 2) {
    parts.push(
      text(labelX, 84 + subtitleLines.length * 18 + 8, `supaschema is up to ${speedup}× faster`, {
        fill: theme.accent,
        size: 14.5,
        weight: "700",
      })
    );
  }
  pushTickGrid(parts, {
    domainMax,
    plotBottom,
    tickFill: theme.title,
    tickSize: 16,
    top,
    xFor,
  });
  for (const [index, group] of groups.entries()) {
    const y = top + index * rowHeight;
    pushLatencyRow(parts, group, {
      barHeight: 30,
      barRadius: 7,
      labelX,
      rowLabelSize: 17,
      slowestSupa,
      valueLabelSize: 17,
      x0,
      xFor,
      y,
    });
  }
  parts.push(
    text(labelX, height - 22, envFooter(environments, fixture), { fill: theme.muted, size: 11 }),
    svgFooter()
  );
  return parts.join("\n");
}

export function renderCorrectnessSvg(rows, fixture, environments) {
  const groups = groupedCorrectness(rows);
  const width = 1200;
  const rowHeight = 46;
  const labelX = 36;
  const top = 150;
  const height = top + groups.length * rowHeight + 56;
  const columns = [
    { key: "once", label: "applies once", x: 430 },
    { key: "twice", label: "applies twice", x: 610 },
    { key: "match", label: "matches target", x: 790 },
    { key: "f1", label: "output F1", x: 985 },
  ];
  const tablesNote = fixtureScale[fixture]?.tables;
  const title = "migration verification";
  const parts = [
    svgHeader(width, height, title),
    defs(),
    `<rect fill="${theme.bg}" height="100%" rx="14" width="100%" />`,
    text(labelX, 52, title, { fill: theme.title, size: 34, weight: "700" }),
    tableCountBadge(width - labelX, tablesNote ?? `${fixture} fixture`, 18),
    text(
      labelX,
      84,
      "Each generated migration is applied in one transaction, applied again, and the catalog is fingerprinted against the target.",
      { fill: theme.subtitle, size: 14.5 }
    ),
    text(
      labelX,
      104,
      "Output F1 scores generated SQL content against the fixture's ground-truth change manifest (1.000 = exact).",
      { fill: theme.subtitle, size: 14.5 }
    ),
  ];
  for (const column of columns) {
    parts.push(
      text(column.x + 60, top - 16, column.label, {
        anchor: "middle",
        fill: theme.muted,
        size: 13.5,
        weight: "600",
      })
    );
  }
  for (const [index, group] of groups.entries()) {
    const y = top + index * rowHeight;
    const supa = isSupaschema(group.label);
    if (supa) {
      parts.push(`<circle cx="${labelX + 5}" cy="${y + 11}" fill="${theme.accent}" r="4" />`);
    }
    parts.push(
      text(labelX + 18, y + 15, truncate(group.label, 30), {
        fill: supa ? theme.title : theme.text,
        size: 15.5,
        weight: supa ? "650" : "450",
      })
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
    svgFooter()
  );
  return parts.join("\n");
}
