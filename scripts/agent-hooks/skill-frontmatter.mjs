import fs from "node:fs";
import path from "node:path";

const defaultRoot = path.resolve(".");

export function discoverSkills(root = defaultRoot, runtime = "claude") {
  const base = skillRoots(root, runtime).find((candidate) => fs.existsSync(candidate));
  const out = [];
  for (const file of listSkillFiles(base ?? "")) {
    const source = fs.readFileSync(file, "utf8");
    const frontmatter = parseFrontmatter(source);
    const dir = path.dirname(file);
    const name = stringValue(frontmatter.name) || path.basename(dir);
    out.push({
      description: stringValue(frontmatter.description),
      fileTriggers: stringArray(frontmatter["metadata.file-triggers"]),
      keywords: stringArray(frontmatter["metadata.keywords"]),
      name,
      path: file,
      relativePath: path.relative(root, file).split(path.sep).join("/"),
      whenToUse: stringValue(frontmatter.when_to_use),
    });
  }
  return out;
}

function skillRoots(root, runtime) {
  return runtime === "codex"
    ? [path.join(root, ".agents", "skills"), path.join(root, ".claude", "skills")]
    : [path.join(root, ".claude", "skills"), path.join(root, ".agents", "skills")];
}

function parseFrontmatter(text) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines[0] !== "---") {
    return {};
  }
  const out = {};
  let current = "";
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "---") {
      return out;
    }
    current = readFrontmatterLine(line, current, out);
  }
  return out;
}

function readFrontmatterLine(line, current, out) {
  const trimmed = line.trim();
  if (trimmed.endsWith(":")) {
    return trimmed.slice(0, -1);
  }
  if (trimmed.startsWith("- ")) {
    const key = current.startsWith("metadata.") ? current : `metadata.${current}`;
    out[key] = [...(out[key] ?? []), unquote(trimmed.slice(2).trim())];
    return current;
  }
  const scalar = frontmatterScalar(trimmed);
  if (!scalar) {
    return current;
  }
  if (current === "metadata" && metadataListKey(scalar.key)) {
    const key = `metadata.${scalar.key}`;
    out[key] = scalar.value ? [scalar.value] : [];
    return key;
  }
  out[scalar.key] = scalar.value;
  return scalar.key;
}

function frontmatterScalar(trimmed) {
  const separator = trimmed.indexOf(":");
  if (separator === -1) {
    return;
  }
  return {
    key: trimmed.slice(0, separator).trim(),
    value: unquote(trimmed.slice(separator + 1).trim()),
  };
}

function metadataListKey(key) {
  return key === "keywords" || key === "file-triggers";
}

function listSkillFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name, "SKILL.md");
    if (entry.isDirectory() && fs.existsSync(file)) {
      out.push(file);
    }
  }
  return out.sort();
}

function unquote(value) {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
