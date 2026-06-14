#!/usr/bin/env node
// Enforces the supaschema Mintlify authoring standard. It parses docs as
// Markdown/MDX and lints the resulting syntax tree so headings, links, code
// fences, and JSX components are classified structurally.
//
// Run: npm run docs:lint   (also runs as the first step of `docs:check`)
import { globSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { toString as nodeText } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";

const DOCS_GLOB = "docs/**/*.{md,mdx}";
const DOCS_SITE_HOSTS = new Set(["supaschema.com", "www.supaschema.com"]);

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm);
const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkMdx);

const toPosix = (path) => path.replaceAll("\\", "/");
const lineOf = (node) => node.position?.start?.line ?? 1;
const firstWord = (text) => {
  const trimmed = text.trim();
  const spaceIndex = [...trimmed].findIndex((character) =>
    [" ", "\t", "\n", "\r", "\f"].includes(character),
  );
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
};

const isMdxJsxNode = (node) =>
  node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

const hasMarkdownExtension = (pathname) => pathname.endsWith(".md") || pathname.endsWith(".mdx");

const isDocsSiteUrl = (url) =>
  (url.protocol === "http:" || url.protocol === "https:") &&
  DOCS_SITE_HOSTS.has(url.hostname) &&
  (url.pathname === "/docs" || url.pathname.startsWith("/docs/"));

const targetPathname = (target) => {
  try {
    return new URL(target, "https://docs.local").pathname;
  } catch {
    return target;
  }
};

const classifyInternalLink = (target) => {
  const trimmed = target.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("?") ||
    trimmed.startsWith("mailto:")
  ) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (isDocsSiteUrl(url)) {
      return `link "${trimmed}" - use a root-relative path (e.g. /commands/diff), not the absolute docs URL`;
    }
    return undefined;
  } catch {
    // Relative URLs are handled below.
  }

  const pathname = targetPathname(trimmed);
  if (trimmed.startsWith("/")) {
    if (pathname === "/docs" || pathname.startsWith("/docs/")) {
      return `link "${trimmed}" - omit the docs directory and use the docs-root path (e.g. /configuration/hints)`;
    }
    if (hasMarkdownExtension(pathname)) {
      return `link "${trimmed}" - use a root-relative, extensionless path (e.g. /configuration/hints)`;
    }
    return undefined;
  }

  if (pathname === "docs" || pathname.startsWith("docs/")) {
    return `link "${trimmed}" - use a root-relative path without the docs directory (e.g. /configuration/hints)`;
  }
  if (hasMarkdownExtension(pathname)) {
    return `link "${trimmed}" - use a root-relative, extensionless path (e.g. /configuration/hints)`;
  }
  return `link "${trimmed}" - docs links must be root-relative (e.g. /configuration/hints)`;
};

const addLinkViolation = (violations, file, line, target) => {
  const msg = classifyInternalLink(target);
  if (msg) violations.push({ file, line, rule: "internal-link", msg });
};

const readFrontmatter = (tree, file, violations) => {
  const firstNode = tree.children[0];
  if (firstNode?.type !== "yaml" || lineOf(firstNode) !== 1) {
    violations.push({
      file,
      line: 1,
      rule: "frontmatter",
      msg: "page must open with a YAML frontmatter block (---)",
    });
    return;
  }

  let data;
  try {
    data = parseYaml(firstNode.value);
  } catch (error) {
    violations.push({
      file,
      line: 1,
      rule: "frontmatter",
      msg: `frontmatter is not valid YAML: ${error.message}`,
    });
    return;
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    violations.push({
      file,
      line: 1,
      rule: "frontmatter",
      msg: "frontmatter must be a YAML mapping",
    });
    return;
  }
  if (typeof data.title !== "string" || data.title.trim().length === 0) {
    violations.push({ file, line: 1, rule: "frontmatter", msg: "missing `title`" });
  }
  if (typeof data.description !== "string" || data.description.trim().length === 0) {
    violations.push({ file, line: 1, rule: "frontmatter", msg: "missing `description`" });
  }
};

export function lintDocsStandard({ rootDir = process.cwd(), files } = {}) {
  const relativeFiles = (files ?? globSync(DOCS_GLOB, { cwd: rootDir })).map(toPosix).sort();
  const violations = [];

  for (const file of relativeFiles) {
    const absoluteFile = isAbsolute(file) ? file : join(rootDir, file);
    const displayFile = toPosix(isAbsolute(file) ? relative(rootDir, absoluteFile) : file);
    const text = readFileSync(absoluteFile, "utf8");
    const processor = displayFile.endsWith(".mdx") ? mdxProcessor : markdownProcessor;
    let tree;

    try {
      tree = processor.parse(text);
    } catch (error) {
      violations.push({
        file: displayFile,
        line: error.line ?? 1,
        rule: "parse",
        msg: error.message,
      });
      continue;
    }

    readFrontmatter(tree, displayFile, violations);

    let hasFlagsOrOptionsHeading = false;
    let hasParamField = false;

    visit(tree, (node) => {
      if (node.type === "heading") {
        const headingText = nodeText(node);
        if (node.depth === 1) {
          violations.push({
            file: displayFile,
            line: lineOf(node),
            rule: "body-h1",
            msg: "drop the body `# ` heading - the frontmatter `title` is the page H1; start in-page headings at `##`",
          });
        }
        if (node.depth === 2 && ["Flags", "Options"].includes(firstWord(headingText))) {
          hasFlagsOrOptionsHeading = true;
        }
      }

      if (
        node.type === "code" &&
        typeof node.meta === "string" &&
        node.meta.includes("theme={null}")
      ) {
        violations.push({
          file: displayFile,
          line: lineOf(node),
          rule: "fence-artifact",
          msg: "remove `theme={null}` from the code fence",
        });
      }

      if ((node.type === "link" || node.type === "definition") && typeof node.url === "string") {
        addLinkViolation(violations, displayFile, lineOf(node), node.url);
      }

      if (isMdxJsxNode(node)) {
        if (node.name === "ParamField") hasParamField = true;
        for (const attribute of node.attributes ?? []) {
          if (
            attribute.type === "mdxJsxAttribute" &&
            attribute.name === "href" &&
            typeof attribute.value === "string"
          ) {
            addLinkViolation(violations, displayFile, lineOf(attribute), attribute.value);
          }
        }
      }
    });

    if (
      displayFile.startsWith("docs/commands/") &&
      displayFile.endsWith(".mdx") &&
      hasFlagsOrOptionsHeading &&
      !hasParamField
    ) {
      violations.push({
        file: displayFile,
        line: 1,
        rule: "component",
        msg: "command page has a Flags/Options section but no <ParamField> - document each flag with <ParamField> (Mintlify standard)",
      });
    }
  }

  return violations;
}

export function formatViolations(violations, pageCount) {
  if (violations.length === 0) return `docs-standard: ${pageCount} pages OK`;

  const filesWithViolations = new Set(violations.map((violation) => violation.file)).size;
  const lines = [
    `docs-standard: ${violations.length} violation(s) across ${filesWithViolations} file(s):`,
    "",
  ];
  for (const violation of violations) {
    lines.push(`  ${violation.file}:${violation.line}  [${violation.rule}] ${violation.msg}`);
  }
  lines.push("", 'See AGENTS.md "Documentation authoring standard" for the full contract.');
  return lines.join("\n");
}

export function runCli() {
  const files = globSync(DOCS_GLOB, { cwd: process.cwd() }).map(toPosix).sort();
  const violations = lintDocsStandard({ files });
  const output = formatViolations(violations, files.length);
  if (violations.length === 0) {
    console.log(output);
    return 0;
  }
  console.error(output);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(runCli());
}
