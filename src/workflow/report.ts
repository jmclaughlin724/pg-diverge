export function migrationTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}

export function render(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export function stripSqlExtension(value: string): string {
  return value.endsWith(".sql") ? value.slice(0, -4) : value;
}
