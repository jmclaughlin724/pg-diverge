import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function pathContainsOrEqual(parent: string, child: string): boolean {
  const rel = relative(canonicalPath(parent), canonicalPath(child));
  return !(rel.startsWith("..") || isAbsolute(rel));
}

export function pathsOverlap(a: string, b: string): boolean {
  return pathContainsOrEqual(a, b) || pathContainsOrEqual(b, a);
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
