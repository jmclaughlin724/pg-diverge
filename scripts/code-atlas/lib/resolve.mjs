import path from "node:path";
import { CODE_EXTENSIONS } from "./config.mjs";

export function resolveImport(fromFile, specifier, fileSet) {
  if (!specifier.startsWith(".")) {
    return;
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const parsed = path.posix.parse(base);
  const sourceEquivalent = runtimeJsExtension(parsed.ext)
    ? path.posix.join(parsed.dir, parsed.name)
    : undefined;
  const candidates = [
    base,
    ...(sourceEquivalent ? [`${sourceEquivalent}.ts`, `${sourceEquivalent}.tsx`] : []),
    ...[...CODE_EXTENSIONS, ".json"].map((extension) => `${base}${extension}`),
    ...[...CODE_EXTENSIONS].map((extension) => path.posix.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => fileSet.has(candidate));
}

export function packageNameFromSpecifier(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function commandFileTargets(command, fileSet) {
  const targets = [];
  for (const token of commandTokens(command)) {
    if (fileSet.has(token)) {
      targets.push(token);
    }
  }
  return [...new Set(targets)].sort();
}

function commandTokens(command) {
  let normalized = "";
  for (const char of command) {
    normalized += separators.has(char) ? " " : char;
  }
  return normalized.split(" ").filter(Boolean);
}

function runtimeJsExtension(extension) {
  return (
    extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs"
  );
}

const separators = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  '"',
  "'",
  "`",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ";",
  "|",
  "&",
]);
