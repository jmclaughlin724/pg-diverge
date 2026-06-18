export const fixtureScale = {
  additive: { order: 0, tables: "1 table" },
  "functions-policies": { order: 1, tables: "1 table" },
  realistic: { order: 2, tables: "50 tables" },
  xl: { order: 3, tables: "1,000 tables" },
  xxl: { order: 4, tables: "2,500 tables" },
};

export const theme = {
  accent: "#FACC15",
  accentDeep: "#A91616",
  amber: "#FACC15",
  bg: "#160807",
  fail: "#FCA5A5",
  failFill: "rgba(169,22,22,0.16)",
  failStroke: "#A91616",
  grid: "#3B1A15",
  muted: "#9B746A",
  mutedFill: "rgba(155,116,106,0.16)",
  neutralFill: "rgba(138,98,85,0.18)",
  pass: "#3ECF8E",
  passFill: "rgba(62,207,142,0.14)",
  passStroke: "#10B981",
  slateBar: "#8A6255",
  slateBarDeep: "#3C241D",
  subtitle: "#D8B49C",
  success: "#3ECF8E",
  text: "#FFF2E1",
  title: "#FFF8EA",
  warnFill: "rgba(250,204,21,0.14)",
};

const fontStack =
  "Aptos, 'Avenir Next', ui-sans-serif, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif";

export function formatSeconds(ms) {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(2)}s`;
  }
  if (seconds < 100) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

export function isSupaschema(label) {
  return label.startsWith("supaschema");
}

export function isWorkflow(label) {
  return label.endsWith("-workflow");
}

export function logTicks(minMs, maxMs) {
  const candidates = [
    10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000,
    1_000_000,
  ];
  return candidates.filter((value) => value >= minMs && value <= maxMs * 1.05);
}

export function logDomain(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const floor = 10 ** Math.floor(Math.log10(Math.max(1, min)));
  const ceil = 10 ** Math.ceil(Math.log10(Math.max(floor * 10, max)));
  return { ceil, floor };
}

export function logX(value, domain, x0, chartWidth) {
  const span = Math.log10(domain.ceil) - Math.log10(domain.floor);
  return x0 + ((Math.log10(Math.max(1, value)) - Math.log10(domain.floor)) / span) * chartWidth;
}

export function envFooter(environments, fixture) {
  const env =
    (fixture === undefined
      ? environments[0]
      : environments.find((item) => item.fixtures.includes(fixture))) ??
    environments[0] ??
    {};
  const supabaseVersion = env.toolVersions?.supabase
    ? `Supabase CLI ${env.toolVersions.supabase}`
    : undefined;
  const supaschemaVersion = env.toolVersions?.supaschema
    ? `supaschema ${env.toolVersions.supaschema}`
    : undefined;
  return [
    supaschemaVersion,
    supabaseVersion,
    env.node ? `Node ${env.node}` : undefined,
    platformLabel(env.platform, env.arch),
    iterationsLabel(fixture === undefined ? environments : [env]),
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function iterationsLabel(environments) {
  const counts = [
    ...new Set(environments.map((item) => item.iterations).filter((value) => value > 0)),
  ].sort((left, right) => left - right);
  if (counts.length === 0) {
    return;
  }
  if (counts.length === 1) {
    return `${counts[0]} iteration${counts[0] === 1 ? "" : "s"}`;
  }
  return `${counts[0]}–${counts.at(-1)} iterations per fixture`;
}

function platformLabel(platform, arch) {
  if (platform === "darwin") {
    return arch === "arm64" ? "Apple Silicon" : "macOS";
  }
  return [platform, arch].filter(Boolean).join(" ") || undefined;
}

export function groupedStats(rows) {
  const map = new Map();
  for (const row of rows) {
    const label = row.adapter;
    const bucket = map.get(label) ?? [];
    bucket.push(row.elapsedMs);
    map.set(label, bucket);
  }
  return [...map.entries()]
    .map(([label, values]) => ({
      label,
      median: percentile(values, 0.5),
      p95: percentile(values, 0.95),
    }))
    .sort((left, right) => left.median - right.median || left.label.localeCompare(right.label));
}

export function groupedCorrectness(rows) {
  const map = new Map();
  for (const row of rows) {
    const label = row.adapter;
    const bucket = map.get(label) ?? [];
    bucket.push(row);
    map.set(label, bucket);
  }
  return [...map.entries()]
    .map(([label, values]) => {
      const measured = values.filter((item) => !(item.skipped || item.unsupported));
      const scored = measured.filter((item) => typeof item.outputF1 === "number");
      return {
        f1:
          scored.length > 0
            ? scored.reduce((sum, item) => sum + item.outputF1, 0) / scored.length
            : undefined,
        label,
        match: measured.filter((item) => item.matchesTargetAfterFirstApply).length,
        once: measured.filter((item) => item.appliesOnce).length,
        total: measured.length,
        twice: measured.filter((item) => item.appliesTwice).length,
      };
    })
    .sort(
      (left, right) =>
        Number(isSupaschema(right.label)) - Number(isSupaschema(left.label)) ||
        left.label.localeCompare(right.label)
    );
}

export function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}

export function svgHeader(width, height, title) {
  return [
    `<svg height="${height}" role="img" viewBox="0 0 ${width} ${height}" width="${width}" xmlns="http://www.w3.org/2000/svg">`,
    `<title>${escapeXml(title)}</title>`,
  ].join("\n");
}

export function defs() {
  return `<defs>
<linearGradient id="supaGradient" x1="0" x2="1" y1="0" y2="0">
<stop offset="0%" stop-color="${theme.accentDeep}" />
<stop offset="100%" stop-color="${theme.accent}" />
</linearGradient>
<linearGradient id="slateGradient" x1="0" x2="1" y1="0" y2="0">
<stop offset="0%" stop-color="${theme.slateBarDeep}" />
<stop offset="100%" stop-color="${theme.slateBar}" />
</linearGradient>
</defs>`;
}

export function svgFooter() {
  return "</svg>";
}

export function text(x, y, value, options = {}) {
  const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : "";
  const weight = options.weight ?? "400";
  const fill = options.fill ?? theme.text;
  const size = options.size ?? 12;
  return `<text fill="${fill}" font-family="${fontStack}" font-size="${size}" font-weight="${weight}"${anchor} x="${typeof x === "number" ? x.toFixed(1) : x}" y="${typeof y === "number" ? y.toFixed(1) : y}">${escapeXml(value)}</text>`;
}

export function chip(x, y, label, kind) {
  const palette = {
    fail: { fill: theme.failFill, stroke: theme.failStroke, text: theme.fail },
    muted: { fill: theme.mutedFill, stroke: theme.muted, text: theme.subtitle },
    pass: { fill: theme.passFill, stroke: theme.passStroke, text: theme.pass },
    warn: { fill: theme.warnFill, stroke: theme.amber, text: theme.success },
  }[kind];
  return [
    `<rect fill="${palette.fill}" height="32" rx="16" stroke="${palette.stroke}" stroke-opacity="0.55" width="120" x="${x}" y="${y}" />`,
    text(x + 60, y + 21.4, label, {
      anchor: "middle",
      fill: palette.text,
      size: 16,
      weight: "600",
    }),
  ].join("\n");
}

export function passFailChip(x, y, passed, total) {
  if (passed === total) {
    return chip(x, y, `✓ ${passed}/${total}`, "pass");
  }
  if (passed === 0) {
    return chip(x, y, `✗ 0/${total}`, "fail");
  }
  return chip(x, y, `△ ${passed}/${total}`, "warn");
}

export function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

export function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
