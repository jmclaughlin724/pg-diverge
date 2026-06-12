export const fixtureScale = {
  additive: { order: 0, tables: "1 table" },
  "functions-policies": { order: 1, tables: "1 table" },
  realistic: { order: 2, tables: "50 tables" },
  xl: { order: 3, tables: "1,000 tables" },
  xxl: { order: 4, tables: "2,500 tables" },
};

export const theme = {
  accent: "#34d399",
  accentDeep: "#059669",
  amber: "#fbbf24",
  bg: "#0b1220",
  fail: "#f87171",
  failStroke: "#ef4444",
  grid: "#1e293b",
  muted: "#64748b",
  pass: "#34d399",
  passStroke: "#10b981",
  slateBar: "#526079",
  slateBarDeep: "#3b4757",
  subtitle: "#94a3b8",
  text: "#e2e8f0",
  title: "#f8fafc",
};

const fontStack = "ui-sans-serif, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif";

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

export function logTicks(minMs, maxMs) {
  const candidates = [
    10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000,
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
  return x0 + ((Math.log10(value) - Math.log10(domain.floor)) / span) * chartWidth;
}

export function envFooter(environments, fixture) {
  const env = environments.find((item) => item.fixtures.includes(fixture)) ?? environments[0] ?? {};
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
    env.platform === "darwin" ? "Apple Silicon" : env.platform,
    env.iterations ? `${env.iterations} iteration${env.iterations === 1 ? "" : "s"}` : undefined,
  ]
    .filter(Boolean)
    .join("  ·  ");
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
      const measured = values.filter((item) => !item.skipped && !item.unsupported);
      const scored = measured.filter((item) => typeof item.outputF1 === "number");
      return {
        f1:
          scored.length > 0
            ? scored.reduce((sum, item) => sum + item.outputF1, 0) / scored.length
            : undefined,
        label,
        match: measured.filter((item) => item.matchesTargetFingerprint).length,
        once: measured.filter((item) => item.appliesOnce).length,
        total: measured.length,
        twice: measured.filter((item) => item.appliesTwice).length,
      };
    })
    .sort(
      (left, right) =>
        Number(isSupaschema(right.label)) - Number(isSupaschema(left.label)) ||
        left.label.localeCompare(right.label),
    );
}

export function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}

export function svgHeader(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
}

export function defs() {
  return `<defs>
<linearGradient id="supaGradient" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="${theme.accentDeep}" />
<stop offset="100%" stop-color="${theme.accent}" />
</linearGradient>
<linearGradient id="slateGradient" x1="0" y1="0" x2="1" y2="0">
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
  return `<text x="${typeof x === "number" ? x.toFixed(1) : x}" y="${typeof y === "number" ? y.toFixed(1) : y}" fill="${fill}" font-family="${fontStack}" font-size="${size}" font-weight="${weight}"${anchor}>${escapeXml(value)}</text>`;
}

export function chip(x, y, label, kind) {
  const palette = {
    fail: { fill: "rgba(239,68,68,0.12)", stroke: theme.failStroke, text: theme.fail },
    muted: { fill: "rgba(100,116,139,0.12)", stroke: theme.muted, text: theme.subtitle },
    pass: { fill: "rgba(16,185,129,0.14)", stroke: theme.passStroke, text: theme.pass },
    warn: { fill: "rgba(251,191,36,0.12)", stroke: theme.amber, text: theme.amber },
  }[kind];
  return [
    `<rect x="${x}" y="${y}" width="120" height="23" rx="11.5" fill="${palette.fill}" stroke="${palette.stroke}" stroke-opacity="0.55" />`,
    text(x + 60, y + 15.5, label, {
      anchor: "middle",
      fill: palette.text,
      size: 11.5,
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
