import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function pathContainsOrEqual(parent: string, child: string): boolean {
  return resolvedPathContainsOrEqual(canonicalPath(parent), canonicalPath(child));
}

export function resolvedPathContainsOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function pathsOverlap(a: string, b: string): boolean {
  return pathContainsOrEqual(a, b) || pathContainsOrEqual(b, a);
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const missingSegments: string[] = [];
    let current = absolute;
    while (true) {
      const parent = dirname(current);
      if (parent === current) {
        return absolute;
      }
      missingSegments.unshift(basename(current));
      current = parent;
      try {
        return resolve(realpathSync(current), ...missingSegments);
      } catch {
        // Keep walking up until an existing ancestor can be canonicalized.
      }
    }
  }
}
