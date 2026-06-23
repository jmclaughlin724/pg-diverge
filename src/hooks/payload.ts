export function property(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

export function asObject(value: unknown): object {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
