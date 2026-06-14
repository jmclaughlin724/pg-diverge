#!/usr/bin/env node
// Enforces the supaschema Mintlify authoring standard. Catches the regressions that
// `mint validate`/`broken-links`/`a11y` do not: duplicate body H1, copy-paste fence
// artifacts, raw repo-relative internal links, and command pages that drop the
// recommended `<ParamField>` component in favor of plain markdown.
//
// Run: npm run docs:lint   (also runs as the first step of `docs:check`)
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const DOCS_GLOB = "docs/**/*.{md,mdx}";
const violations = [];
const add = (file, line, rule, msg) => violations.push({ file, line, rule, msg });

const files = globSync(DOCS_GLOB).sort();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  // --- Frontmatter: title + description required ---
  if (lines[0] !== "---") {
    add(file, 1, "frontmatter", "page must open with a YAML frontmatter block (---)");
    continue;
  }
  let fmEnd = lines.indexOf("---", 1);
  if (fmEnd === -1) {
    add(file, 1, "frontmatter", "frontmatter block is not closed");
    continue;
  }
  const fm = lines.slice(1, fmEnd).join("\n");
  if (!/^title:\s*\S/m.test(fm)) add(file, 1, "frontmatter", "missing `title`");
  if (!/^description:\s*\S/m.test(fm)) add(file, 1, "frontmatter", "missing `description`");

  // --- Body checks (skip fenced code) ---
  let inFence = false;
  for (let i = fmEnd + 1; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    if (/^\s*```/.test(line)) {
      // theme={null} artifact lives on the opening fence info string
      if (/\btheme=\{null\}/.test(line)) {
        add(file, ln, "fence-artifact", "remove `theme={null}` from the code fence");
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Any single-`#` heading in the body is a duplicate of the frontmatter title H1
    if (/^#\s+\S/.test(line)) {
      add(file, ln, "body-h1", "drop the body `# ` heading — the frontmatter `title` is the page H1; start in-page headings at `##`");
    }

    // Internal links must be root-relative + extensionless (no .md/.mdx, no `docs/` paths, no absolute site URL)
    const linkRe = /\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRe.exec(line))) {
      const target = m[1].trim();
      if (/^(https?:\/\/(?!(www\.)?supaschema\.com\/docs)|mailto:|#)/.test(target)) continue; // external/anchor ok
      if (/^https?:\/\/(www\.)?supaschema\.com\/docs/.test(target)) {
        add(file, ln, "internal-link", `link "${target}" — use a root-relative path (e.g. /commands/diff), not the absolute docs URL`);
      } else if (/\.mdx?($|#)/.test(target) || /(^|\/)docs\//.test(target)) {
        add(file, ln, "internal-link", `link "${target}" — use a root-relative, extensionless path (e.g. /configuration/hints)`);
      }
    }
  }

  // --- Command reference pages must use <ParamField> for flags ---
  if (/^docs\/commands\/[^/]+\.mdx$/.test(file) && /^##\s+(Flags|Options)\b/m.test(text)) {
    if (!/<ParamField\b/.test(text)) {
      add(file, 1, "component", "command page has a Flags/Options section but no <ParamField> — document each flag with <ParamField> (Mintlify standard)");
    }
  }
}

if (violations.length === 0) {
  console.log(`docs-standard: ${files.length} pages OK`);
  process.exit(0);
}
console.error(`docs-standard: ${violations.length} violation(s) across ${new Set(violations.map((v) => v.file)).size} file(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.msg}`);
}
console.error(`\nSee AGENTS.md “Documentation authoring standard” for the full contract.`);
process.exit(1);
