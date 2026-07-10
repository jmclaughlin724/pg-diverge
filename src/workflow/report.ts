export function render(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export function stripSqlExtension(value: string): string {
  return value.endsWith(".sql") ? value.slice(0, -4) : value;
}
