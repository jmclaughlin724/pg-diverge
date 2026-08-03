import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const defaultRoot = path.resolve(".");

export function discoverSkills(root = defaultRoot, runtime = "claude") {
  const base = skillRoots(root, runtime).find((candidate) => fs.existsSync(candidate));
  const out = [];
  for (const file of listSkillFiles(base ?? "")) {
    const source = fs.readFileSync(file, "utf8");
    const frontmatter = parseFrontmatter(source, file);
    const metadata = recordValue(frontmatter.metadata);
    const directory = path.dirname(file);
    const name = stringValue(frontmatter.name) || path.basename(directory);
    out.push({
      description: stringValue(frontmatter.description),
      fileTriggers: stringArray(metadata["file-triggers"]),
      isPublic: metadata.public === true,
      keywords: stringArray(metadata.keywords),
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

function parseFrontmatter(text, file) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines[0] !== "---") {
    return {};
  }
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex === -1) {
    throw new Error(`unterminated skill frontmatter: ${file}`);
  }
  const document = parseDocument(lines.slice(1, closingIndex).join("\n"), {
    prettyErrors: false,
    strict: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`invalid skill frontmatter: ${file}: ${document.errors[0].message}`);
  }
  return recordValue(document.toJS());
}

function listSkillFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const rootStats = fs.lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`skill source must be a regular directory: ${root}`);
  }
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name, "SKILL.md");
    if (entry.isDirectory() && fs.existsSync(file)) {
      const fileStats = fs.lstatSync(file);
      if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
        throw new Error(`skill source must be a regular file: ${file}`);
      }
      out.push(file);
    }
  }
  return out.sort();
}

function recordValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
