import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const skillsDir = ".claude/skills";
const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const results = [];
for (const dir of skillDirs) {
  const path = join(skillsDir, dir, "SKILL.md");
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    results.push({ dir, path, error: "MISSING_SKILL_MD" });
    continue;
  }
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    results.push({ dir, path, error: "NO_FRONTMATTER" });
    continue;
  }
  let fm;
  try {
    fm = parseYaml(match[1]);
  } catch {
    results.push({ dir, path, error: "YAML_PARSE_ERROR" });
    continue;
  }
  const name = fm?.name ?? null;
  const fileTriggers = fm?.metadata?.["file-triggers"] ?? null;
  const isPublic = fm?.metadata?.public ?? false;
  results.push({ dir, path, name, fileTriggers, isPublic });
}

console.log(JSON.stringify(results, null, 2));
