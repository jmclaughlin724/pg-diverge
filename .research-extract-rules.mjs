import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const rulesDir = ".claude/rules";
const files = readdirSync(rulesDir, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith(".md"))
  .map((d) => d.name)
  .sort();

const results = [];
for (const file of files) {
  const path = join(rulesDir, file);
  const content = readFileSync(path, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    results.push({ file, path, error: "NO_FRONTMATTER" });
    continue;
  }
  let fm;
  try {
    fm = parseYaml(match[1]);
  } catch {
    results.push({ file, path, error: "YAML_PARSE_ERROR" });
    continue;
  }
  const paths = fm?.paths ?? null;
  const enforcementType = fm?.enforcement?.type ?? null;
  const description = fm?.description ?? null;
  results.push({ file, path, paths, enforcementType, description });
}

console.log(JSON.stringify(results, null, 2));
