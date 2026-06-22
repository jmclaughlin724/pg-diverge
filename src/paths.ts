import { isAbsolute, relative, resolve } from "node:path";

export function pathContainsOrEqual(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return !(rel.startsWith("..") || isAbsolute(rel));
}

export function pathsOverlap(a: string, b: string): boolean {
  return pathContainsOrEqual(a, b) || pathContainsOrEqual(b, a);
}
