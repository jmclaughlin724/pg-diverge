import {
  chip,
  defs,
  envFooter,
  fixtureScale,
  formatSeconds,
  groupedCorrectness,
  groupedStats,
  isSupaschema,
  logDomain,
  logTicks,
  logX,
  passFailChip,
  percentile,
  svgFooter,
  svgHeader,
  text,
  theme,
  truncate,
} from "./plot-lib.js";

export function renderLatencySvg(rows, fixture, environments) {
  const groups = groupedStats(rows);
  const width = 1200;
  const rowHeight = 34;
  const labelX = 36;
  const x0 = 300;
  const chartWidth = 660;
  const valueX = width - 36;
  const top = 108;
  const height = top + groups.length * rowHeight + 64;
  const domain = logDomain(groups.flatMap((item) => [item.median, item.p95]));
  const ticks = logTicks(domain.floor, domain.ceil);
  const tablesNote = fixtureScale[fixture]?.tables;
  const parts = [
    svgHeader(width, height),
    defs(),
    `<rect width="100%" height="100%" rx="14" fill="${theme.bg}" />`,
    text(labelX, 46, `Diff latency — ${fixture} fixture${tablesNote ? ` (${tablesNote})` : ""}`, {
      fill: theme.title,
      size: 21,
      weight: "700",
    }),
    text(labelX, 70, "Median seconds per diff, log scale · whisker marks p95 · lower is better", {
      fill: theme.subtitle,
      size: 12.5,
    }),
  ];
  const plotBottom = top + groups.length * rowHeight - 10;
  for (const tickValue of ticks) {
    const tickX = logX(tickValue, domain, x0, chartWidth);
    parts.push(
      `<line x1="${tickX.toFixed(1)}" y1="${top - 14}" x2="${tickX.toFixed(1)}" y2="${plotBottom}" stroke="${theme.grid}" stroke-width="1" />`,
    );
    parts.push(
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
    const barEnd = logX(group.median, domain, x0, chartWidth);
    const p95X = logX(group.p95, domain, x0, chartWidth);
    if (supa) {
      parts.push(`<circle cx="${labelX + 5}" cy="${y + 9}" r="4" fill="${theme.accent}" />`);
    }
    parts.push(
      text(labelX + 18, y + 13, truncate(group.label, 30), {
        fill: supa ? theme.title : theme.text,
        size: 13,
        weight: supa ? "650" : "450",
      }),
    );
    parts.push(
      `<rect x="${x0}" y="${y}" width="${Math.max(2, barEnd - x0).toFixed(1)}" height="18" rx="4" fill="${barFill}" />`,
    );
    parts.push(
      `<line x1="${p95X.toFixed(1)}" y1="${y - 3}" x2="${p95X.toFixed(1)}" y2="${y + 21}" stroke="${theme.title}" stroke-opacity="0.55" stroke-width="2" />`,
    );
    parts.push(
      text(valueX, y + 13, `${formatSeconds(group.median)}  ·  p95 ${formatSeconds(group.p95)}`, {
        anchor: "end",
        fill: supa ? theme.accent : theme.subtitle,
        size: 12,
        weight: supa ? "650" : "450",
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

export function renderScalingSvg(allResults, fixtures, environments) {
  const width = 1200;
  const height = 560;
  const left = 96;
  const right = width - 270;
  const top = 116;
  const bottom = height - 86;
  const adapters = [...new Set(allResults.map((item) => item.adapter))].sort(
    (a, b) => Number(isSupaschema(b)) - Number(isSupaschema(a)) || a.localeCompare(b),
  );
  const series = adapters.map((adapter) => ({
    adapter,
    points: fixtures
      .map((fixture, index) => {
        const values = allResults
          .filter(
            (item) =>
              item.adapter === adapter &&
              item.fixture === fixture &&
              !item.skipped &&
              !item.unsupported,
          )
          .map((item) => item.elapsedMs);
        return values.length > 0 ? { index, median: percentile(values, 0.5) } : undefined;
      })
      .filter(Boolean),
  }));
  const allMedians = series.flatMap((item) => item.points.map((point) => point.median));
  const domain = logDomain(allMedians);
  const ticks = logTicks(domain.floor, domain.ceil);
  const xFor = (index) => left + (index / Math.max(1, fixtures.length - 1)) * (right - left);
  const yFor = (value) => {
    const span = Math.log10(domain.ceil) - Math.log10(domain.floor);
    return (
      bottom - ((Math.log10(Math.max(1, value)) - Math.log10(domain.floor)) / span) * (bottom - top)
    );
  };
  const supaColors = [theme.accent, "#22d3ee"];
  const engineColors = ["#94a3b8", "#7c8aa0", "#64748b", "#8896ab", "#566379"];
  let supaIndex = 0;
  let engineIndex = 0;
  const parts = [
    svgHeader(width, height),
    defs(),
    `<rect width="100%" height="100%" rx="14" fill="${theme.bg}" />`,
    text(36, 46, "Diff latency vs schema size", { fill: theme.title, size: 21, weight: "700" }),
    text(36, 70, "Median seconds per diff at each fixture scale, log scale · lower is better", {
      fill: theme.subtitle,
      size: 12.5,
    }),
  ];
  for (const tickValue of ticks) {
    const y = yFor(tickValue);
    parts.push(
      `<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" stroke="${theme.grid}" stroke-width="1" />`,
    );
    parts.push(
      text(left - 12, y + 4, formatSeconds(tickValue), {
        anchor: "end",
        fill: theme.muted,
        size: 11,
      }),
    );
  }
  for (const [index, fixture] of fixtures.entries()) {
    const x = xFor(index);
    parts.push(
      text(x, bottom + 26, fixture, {
        anchor: "middle",
        fill: theme.text,
        size: 12,
        weight: "550",
      }),
    );
    const tables = fixtureScale[fixture]?.tables;
    if (tables) {
      parts.push(text(x, bottom + 44, tables, { anchor: "middle", fill: theme.muted, size: 11 }));
    }
  }
  const endLabels = [];
  for (const item of series) {
    const supa = isSupaschema(item.adapter);
    const color = supa
      ? supaColors[supaIndex++ % supaColors.length]
      : engineColors[engineIndex++ % engineColors.length];
    const path = item.points
      .map(
        (point, order) =>
          `${order === 0 ? "M" : "L"}${xFor(point.index).toFixed(1)},${yFor(point.median).toFixed(1)}`,
      )
      .join(" ");
    parts.push(
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="${supa ? 3 : 2}" stroke-linecap="round" stroke-linejoin="round"${supa ? "" : ' stroke-opacity="0.75"'} />`,
    );
    for (const point of item.points) {
      parts.push(
        `<circle cx="${xFor(point.index).toFixed(1)}" cy="${yFor(point.median).toFixed(1)}" r="${supa ? 4.5 : 3.5}" fill="${color}" />`,
      );
    }
    const last = item.points.at(-1);
    if (last) {
      endLabels.push({
        anchorY: yFor(last.median),
        color,
        label: `${item.adapter} ${formatSeconds(last.median)}`,
        supa,
        y: yFor(last.median),
      });
    }
  }
  parts.push(...renderEndLabels(endLabels, { bottom, right, top }));
  parts.push(
    text(36, height - 22, envFooter(environments, undefined), {
      fill: theme.muted,
      size: 11,
    }),
    svgFooter(),
  );
  return parts.join("\n");
}

function renderEndLabels(endLabels, bounds) {
  const minGap = 18;
  endLabels.sort((left, right) => left.anchorY - right.anchorY);
  for (let index = 1; index < endLabels.length; index += 1) {
    if (endLabels[index].y - endLabels[index - 1].y < minGap) {
      endLabels[index].y = endLabels[index - 1].y + minGap;
    }
  }
  const lastLabel = endLabels.at(-1);
  const overflow = lastLabel ? lastLabel.y - bounds.bottom : 0;
  if (overflow > 0) {
    for (const item of endLabels) {
      item.y -= Math.min(overflow, Math.max(0, item.y - bounds.top));
    }
    for (let index = endLabels.length - 2; index >= 0; index -= 1) {
      if (endLabels[index + 1].y - endLabels[index].y < minGap) {
        endLabels[index].y = endLabels[index + 1].y - minGap;
      }
    }
  }
  const parts = [];
  for (const item of endLabels) {
    if (Math.abs(item.y - item.anchorY) > 4) {
      parts.push(
        `<line x1="${bounds.right + 6}" y1="${item.anchorY.toFixed(1)}" x2="${bounds.right + 24}" y2="${(item.y - 4).toFixed(1)}" stroke="${item.color}" stroke-opacity="0.45" stroke-width="1" />`,
      );
    }
    parts.push(
      text(bounds.right + 28, item.y, item.label, {
        fill: item.supa ? item.color : theme.subtitle,
        size: 12,
        weight: item.supa ? "650" : "450",
      }),
    );
  }
  return parts;
}
