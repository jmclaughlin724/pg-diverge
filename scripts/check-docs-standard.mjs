#!/usr/bin/env node

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
import { inspectDocsJson } from "./docs-lint/docs-json.mjs";
import { inspectLocalRunnerConvention } from "./docs-lint/local-runner.mjs";
import { hasMarkdownExtension, isDigit, routeForDocFile } from "./docs-lint/paths.mjs";

const DOCS_GLOB = "docs/**/*.{md,mdx}";
const COMPARISON_PREFIX = "docs/comparisons/";
const DOCS_SITE_HOSTS = new Set(["supaschema.com", "www.supaschema.com"]);
const LOCAL_IMAGE_PREFIX = "/images/";
const FRONTMATTER_MODES = new Set(["default", "wide", "custom", "frame", "center"]);
const GENERIC_LINK_TEXT = new Set([
  "click here",
  "here",
  "learn more",
  "read more",
  "this",
  "this page",
]);
const CALLOUT_COMPONENTS = new Set(["Note", "Info", "Tip", "Warning", "Danger", "Check"]);
const TITLE_CASE_WORD_ALLOWLIST = new Set([
  "AGENTS.md",
  "API",
  "CI",
  "CLI",
  "Codex",
  "GitHub",
  "JSON",
  "MCP",
  "Mintlify",
  "Node.js",
  "PostgreSQL",
  "RLS",
  "SQL",
  "SUPA",
  "Supabase",
  "TypeScript",
  "URL",
  "URLs",
  "Zod",
]);
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
    [" ", "\t", "\n", "\r", "\f"].includes(character)
  );
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
};

const splitWhitespace = (value) => {
  const words = [];
  let current = "";
  for (const char of value) {
    if (isWhitespace(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    words.push(current);
  }
  return words;
};

const collapseWhitespace = (value) => splitWhitespace(value).join(" ");

const trimWordEdgePunctuation = (word) => {
  let start = 0;
  let end = word.length;
  while (start < end && !isWordEdgeChar(word[start] ?? "")) {
    start += 1;
  }
  while (end > start && !isWordEdgeChar(word[end - 1] ?? "")) {
    end -= 1;
  }
  return word.slice(start, end);
};

const isWhitespace = (char) =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

const isWordEdgeChar = (char) =>
  isAsciiLetter(char) || isDigit(char) || char === "_" || char === "." || char === "-";

const isAsciiLetter = (char) => {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
};

const isUppercaseAscii = (char) => {
  const code = char.charCodeAt(0);
  return code >= 65 && code <= 90;
};

const isLowercaseAscii = (char) => {
  const code = char.charCodeAt(0);
  return code >= 97 && code <= 122;
};

const isLowercaseOrDigit = (char) => isLowercaseAscii(char) || isDigit(char);

const isHttpUrl = (value) => value.startsWith("http://") || value.startsWith("https://");

const isTitleCaseWord = (word) =>
  word.length >= 2 && isUppercaseAscii(word[0] ?? "") && isLowercaseAscii(word[1] ?? "");

const isMdxJsxNode = (node) =>
  node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

const isMdxJsxNamed = (node, name) => isMdxJsxNode(node) && node.name === name;

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

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return;
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
    return;
  }

  const url = parseUrl(trimmed);
  if (url !== undefined) {
    if (isDocsSiteUrl(url)) {
      return `link "${trimmed}" - use a root-relative path (e.g. /commands/diff), not the absolute docs URL`;
    }
    return;
  }

  const pathname = targetPathname(trimmed);
  if (trimmed.startsWith("/")) {
    if (pathname === "/docs" || pathname.startsWith("/docs/")) {
      return `link "${trimmed}" - omit the docs directory and use the docs-root path (e.g. /configuration/hints)`;
    }
    if (hasMarkdownExtension(pathname)) {
      return `link "${trimmed}" - use a root-relative, extensionless path (e.g. /configuration/hints)`;
    }
    return;
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
  if (msg) {
    violations.push({ file, line, rule: "internal-link", msg });
  }
};

const getMdxAttribute = (node, name) =>
  (node.attributes ?? []).find(
    (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === name
  );

const mdxAttributeString = (node, name) => {
  const attribute = getMdxAttribute(node, name);
  return typeof attribute?.value === "string" ? attribute.value : undefined;
};

const mdxAttributeNumber = (node, name) => {
  const attribute = getMdxAttribute(node, name);
  if (!attribute) {
    return;
  }
  if (typeof attribute.value === "number") {
    return attribute.value;
  }
  if (
    attribute.value &&
    typeof attribute.value === "object" &&
    attribute.value.type === "mdxJsxAttributeValueExpression"
  ) {
    const parsed = Number(attribute.value.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof attribute.value === "string") {
    const parsed = Number(attribute.value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
};

const wordCount = (text) => splitWhitespace(text.trim()).length;

const childText = (node) => {
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(childText).join(" ");
};

const isWhitespaceText = (node) => node.type === "text" && node.value.trim().length === 0;

const collectMdxDescendants = (node, name, matches = []) => {
  for (const child of node.children ?? []) {
    if (isMdxJsxNamed(child, name)) {
      matches.push(child);
    }
    collectMdxDescendants(child, name, matches);
  }
  return matches;
};

const pushFrontmatterViolation = (violations, file, msg) => {
  violations.push({ file, line: 1, rule: "frontmatter", msg });
};

const readFrontmatter = (tree, file, violations) => {
  const firstNode = tree.children[0];
  if (firstNode?.type !== "yaml" || lineOf(firstNode) !== 1) {
    pushFrontmatterViolation(
      violations,
      file,
      "page must open with a YAML frontmatter block (---)"
    );
    return;
  }

  let data;
  try {
    data = parseYaml(firstNode.value);
  } catch (error) {
    pushFrontmatterViolation(violations, file, `frontmatter is not valid YAML: ${error.message}`);
    return;
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    pushFrontmatterViolation(violations, file, "frontmatter must be a YAML mapping");
    return;
  }
  validateRequiredFrontmatterFields(data, file, violations);
  validateFrontmatterFieldTypes(data, file, violations);
  return data;
};

const validateRequiredFrontmatterFields = (data, file, violations) => {
  if (typeof data.title !== "string" || data.title.trim().length === 0) {
    pushFrontmatterViolation(violations, file, "missing `title`");
  }
  if (typeof data.description !== "string" || data.description.trim().length === 0) {
    pushFrontmatterViolation(violations, file, "missing `description`");
  }
  if (
    !Array.isArray(data.keywords) ||
    data.keywords.length === 0 ||
    !data.keywords.every((keyword) => typeof keyword === "string" && keyword.trim().length > 0)
  ) {
    pushFrontmatterViolation(violations, file, "missing or invalid `keywords` array");
  }
};

const validateFrontmatterFieldTypes = (data, file, violations) => {
  for (const field of ["sidebarTitle", "icon", "iconType", "tag", "api", "openapi", "url"]) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      pushFrontmatterViolation(violations, file, `\`${field}\` must be a string when present`);
    }
  }
  for (const field of ["noindex", "timestamp"]) {
    if (data[field] !== undefined && typeof data[field] !== "boolean") {
      pushFrontmatterViolation(violations, file, `\`${field}\` must be a boolean when present`);
    }
  }
  if (data.hidden !== undefined && data.hidden !== true) {
    pushFrontmatterViolation(
      violations,
      file,
      "`hidden` must be true when present; omit it instead of setting false"
    );
  }
  if (data.mode !== undefined && !FRONTMATTER_MODES.has(data.mode)) {
    pushFrontmatterViolation(
      violations,
      file,
      "`mode` must be one of default, wide, custom, frame, or center"
    );
  }
};

export function lintDocsStandard({ rootDir = process.cwd(), files } = {}) {
  const relativeFiles = (files ?? globSync(DOCS_GLOB, { cwd: rootDir })).map(toPosix).sort();
  const violations = [];
  const frontmatterByRoute = new Map();
  const isFullDocsLint = files === undefined;

  for (const file of relativeFiles) {
    const absoluteFile = isAbsolute(file) ? file : join(rootDir, file);
    const displayFile = toPosix(isAbsolute(file) ? relative(rootDir, absoluteFile) : file);
    const text = readFileSync(absoluteFile, "utf8");
    const processor = displayFile.endsWith(".mdx") ? mdxProcessor : markdownProcessor;
    let tree;

    if (displayFile.endsWith(".md")) {
      violations.push({
        file: displayFile,
        line: 1,
        rule: "page-extension",
        msg: "docs pages must use .mdx so Mintlify components remain available by default",
      });
    }

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

    const frontmatter = readFrontmatter(tree, displayFile, violations);
    if (frontmatter) {
      frontmatterByRoute.set(routeForDocFile(displayFile), frontmatter);
    }

    const state = { hasFlagsOrOptionsHeading: false, hasParamField: false };

    visit(tree, (node) => {
      inspectDocNode(node, displayFile, violations, state);
    });
    visitWithParents(tree, (node, ancestors) => {
      inspectAdjacentCallouts(node, displayFile, violations);
      inspectImageFrame(node, ancestors, displayFile, violations);
    });
    inspectComparisonPage(tree, displayFile, violations);

    if (
      displayFile.startsWith("docs/commands/") &&
      displayFile.endsWith(".mdx") &&
      state.hasFlagsOrOptionsHeading &&
      !state.hasParamField
    ) {
      violations.push({
        file: displayFile,
        line: 1,
        rule: "component",
        msg: "command page has a Flags/Options section but no <ParamField> - document each flag with <ParamField> (Mintlify standard)",
      });
    }
  }

  inspectDocsJson(rootDir, relativeFiles, frontmatterByRoute, violations, {
    requireConfig: files === undefined,
  });
  if (isFullDocsLint) {
    inspectLocalRunnerConvention(rootDir, violations);
  }

  return violations;
}

function inspectDocNode(node, displayFile, violations, state) {
  inspectHeading(node, displayFile, violations, state);
  inspectCodeFence(node, displayFile, violations);
  inspectMarkdownLink(node, displayFile, violations);
  inspectMdxNode(node, displayFile, violations, state);
}

function inspectComparisonPage(tree, displayFile, violations) {
  if (!(displayFile.startsWith(COMPARISON_PREFIX) && displayFile.endsWith(".mdx"))) {
    return;
  }
  if (!hasVerificationDate(nodeText(tree))) {
    violations.push({
      file: displayFile,
      line: 1,
      rule: "comparison-claim",
      msg: "comparison pages must include `Last verified YYYY-MM-DD` for external claims",
    });
  }
  if (!hasSourcedSection(tree)) {
    violations.push({
      file: displayFile,
      line: 1,
      rule: "comparison-claim",
      msg: "comparison pages must include a Sources section with at least one outbound link",
    });
  }
}

function hasVerificationDate(text) {
  const marker = "Last verified ";
  let index = text.indexOf(marker);
  while (index !== -1) {
    if (isIsoDate(text.slice(index + marker.length, index + marker.length + 10))) {
      return true;
    }
    index = text.indexOf(marker, index + 1);
  }
  return false;
}

function isIsoDate(value) {
  if (
    value.length !== 10 ||
    value[4] !== "-" ||
    value[7] !== "-" ||
    ![...value.slice(0, 4)].every(isDigit) ||
    ![...value.slice(5, 7)].every(isDigit) ||
    ![...value.slice(8, 10)].every(isDigit)
  ) {
    return false;
  }
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function hasSourcedSection(tree) {
  const children = tree.children ?? [];
  const headingIndex = children.findIndex(
    (node) => node.type === "heading" && node.depth === 2 && nodeText(node) === "Sources"
  );
  if (headingIndex === -1) {
    return false;
  }
  for (const node of children.slice(headingIndex + 1)) {
    if (node.type === "heading" && node.depth <= 2) {
      break;
    }
    if (hasOutboundLink(node)) {
      return true;
    }
  }
  return false;
}

function hasOutboundLink(node) {
  let found = false;
  visit(node, (child) => {
    if (child.type === "link" && typeof child.url === "string" && isHttpUrl(child.url)) {
      found = true;
    }
  });
  return found;
}

function inspectHeading(node, displayFile, violations, state) {
  if (node.type !== "heading") {
    return;
  }
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
    state.hasFlagsOrOptionsHeading = true;
  }
  if (node.depth >= 2 && isObviousTitleCaseHeading(node, headingText)) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "heading-case",
      msg: `heading "${headingText}" should use sentence case unless it is a command, acronym, code symbol, product name, or diagnostic code`,
    });
  }
}

function inspectCodeFence(node, displayFile, violations) {
  if (node.type !== "code") {
    return;
  }
  if (typeof node.lang !== "string" || node.lang.trim().length === 0) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "code-fence-language",
      msg: "add a code fence language tag (use `text` for terminal output, diagrams, and plain text)",
    });
  }
  if (typeof node.meta === "string" && node.meta.includes("theme={null}")) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "fence-artifact",
      msg: "remove `theme={null}` from the code fence",
    });
  }
}

function inspectMarkdownLink(node, displayFile, violations) {
  if ((node.type === "link" || node.type === "definition") && typeof node.url === "string") {
    addLinkViolation(violations, displayFile, lineOf(node), node.url);
  }
  if (node.type === "link") {
    inspectLinkText(node, displayFile, violations);
  }
  if (node.type === "image") {
    inspectImage(node, displayFile, violations);
  }
}

function inspectMdxNode(node, displayFile, violations, state) {
  if (!isMdxJsxNode(node)) {
    return;
  }
  if (node.name === "ParamField") {
    state.hasParamField = true;
  }
  if (node.name === "img") {
    inspectImgElement(node, displayFile, violations);
  }
  if (node.name === "Columns") {
    inspectColumnsElement(node, displayFile, violations);
  }
  if (node.name === "CardGroup") {
    inspectCardGroupElement(node, displayFile, violations);
  }
  if (node.name === "Card") {
    inspectCardElement(node, displayFile, violations);
  }
  for (const attribute of node.attributes ?? []) {
    if (
      attribute.type === "mdxJsxAttribute" &&
      attribute.name === "href" &&
      typeof attribute.value === "string"
    ) {
      addLinkViolation(violations, displayFile, lineOf(attribute), attribute.value);
    }
    if (
      attribute.type === "mdxJsxAttribute" &&
      (attribute.name === "src" || attribute.name === "img") &&
      typeof attribute.value === "string"
    ) {
      inspectImageSrc(attribute.value, displayFile, lineOf(attribute), violations);
    }
  }
}

function inspectColumnsElement(node, displayFile, violations) {
  if (collectMdxDescendants(node, "Card").length === 0) {
    return;
  }
  violations.push({
    file: displayFile,
    line: lineOf(node),
    rule: "card-grid",
    msg: "use <CardGroup> for docs card grids so the repo has one card layout owner",
  });
}

function inspectCardGroupElement(node, displayFile, violations) {
  const cols = mdxAttributeNumber(node, "cols") ?? 2;
  const cards = collectMdxDescendants(node, "Card");
  if (![2, 3].includes(cols)) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "card-grid",
      msg: "<CardGroup> must use cols={2} or cols={3}",
    });
    return;
  }
  if (cols === 3 && cards.length !== 3) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "card-grid",
      msg: "<CardGroup cols={3}> must contain exactly three direct <Card> children",
    });
  }
  if (cols === 2 && cards.length > 4) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "card-grid",
      msg: "<CardGroup cols={2}> must contain at most four direct <Card> children",
    });
  }
}

function inspectCardElement(node, displayFile, violations) {
  for (const attributeName of ["title", "icon"]) {
    if (typeof mdxAttributeString(node, attributeName) !== "string") {
      violations.push({
        file: displayFile,
        line: lineOf(node),
        rule: "card",
        msg: `<Card> must include a string ${attributeName} attribute`,
      });
    }
  }
  const bodyWords = wordCount(childText(node));
  if (bodyWords > 35) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "card",
      msg: `<Card> body is ${bodyWords} words; keep card bodies to one short sentence (35 words max)`,
    });
  }
}

function inspectLinkText(node, displayFile, violations) {
  const text = collapseWhitespace(nodeText(node).trim().toLowerCase());
  if (!GENERIC_LINK_TEXT.has(text)) {
    return;
  }
  violations.push({
    file: displayFile,
    line: lineOf(node),
    rule: "link-text",
    msg: `link text "${text}" is too generic; use descriptive text that names the destination`,
  });
}

function inspectImage(node, displayFile, violations) {
  if (typeof node.alt !== "string" || node.alt.trim().length === 0) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "image-alt",
      msg: "images need descriptive alt text",
    });
  }
  inspectImageSrc(node.url, displayFile, lineOf(node), violations);
}

function inspectImgElement(node, displayFile, violations) {
  const attributes = new Map(
    (node.attributes ?? [])
      .filter((attribute) => attribute.type === "mdxJsxAttribute")
      .map((attribute) => [attribute.name, attribute.value])
  );
  const alt = attributes.get("alt");
  if (typeof alt !== "string" || alt.trim().length === 0) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "image-alt",
      msg: "`<img>` elements need descriptive alt text",
    });
  }
  const src = attributes.get("src");
  if (typeof src === "string") {
    inspectImageSrc(src, displayFile, lineOf(node), violations);
  }
}

function inspectImageSrc(src, displayFile, line, violations) {
  if (typeof src !== "string" || src.startsWith("#") || isHttpUrl(src)) {
    return;
  }
  if (src.startsWith(LOCAL_IMAGE_PREFIX)) {
    return;
  }
  if (src.startsWith("/")) {
    violations.push({
      file: displayFile,
      line,
      rule: "image-path",
      msg: `local image source "${src}" must live under ${LOCAL_IMAGE_PREFIX}`,
    });
    return;
  }
  violations.push({
    file: displayFile,
    line,
    rule: "image-path",
    msg: `image source "${src}" must be root-relative under ${LOCAL_IMAGE_PREFIX}, e.g. /images/example.png`,
  });
}

function inspectImageFrame(node, ancestors, displayFile, violations) {
  if (node.type === "image") {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "image-frame",
      msg: 'use <Frame><img src="/images/..." alt="..." /></Frame> instead of markdown image syntax',
    });
    return;
  }
  if (!isMdxJsxNode(node) || node.name !== "img") {
    return;
  }
  const isInsideFrame = ancestors.some(
    (ancestor) => isMdxJsxNode(ancestor) && ancestor.name === "Frame"
  );
  if (!isInsideFrame) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      rule: "image-frame",
      msg: "`<img>` elements in docs must be wrapped in a Mintlify <Frame>",
    });
  }
}

function inspectAdjacentCallouts(node, displayFile, violations) {
  let previousCallout;
  for (const child of node.children ?? []) {
    if (isWhitespaceText(child)) {
      continue;
    }
    const currentCallout = isMdxJsxNode(child) && CALLOUT_COMPONENTS.has(child.name);
    if (currentCallout && previousCallout) {
      violations.push({
        file: displayFile,
        line: lineOf(child),
        rule: "callout-spacing",
        msg: "do not stack callouts without intervening explanatory content",
      });
    }
    previousCallout = currentCallout ? child : undefined;
  }
}

function isObviousTitleCaseHeading(node, text) {
  if ((node.children ?? []).some((child) => child.type === "inlineCode")) {
    return false;
  }
  const normalized = text.trim();
  if (
    normalized.length === 0 ||
    !normalized.includes(" ") ||
    isLowercaseOrDigit(normalized[0] ?? "") ||
    normalized.startsWith("SUPA_")
  ) {
    return false;
  }

  const words = splitWhitespace(normalized).map(trimWordEdgePunctuation).filter(Boolean);
  if (words.length < 2) {
    return false;
  }
  if (
    words
      .slice(1)
      .some(
        (word) =>
          isLowercaseAscii(word[0] ?? "") &&
          !["and", "or", "to", "of", "in", "with", "for"].includes(word)
      )
  ) {
    return false;
  }

  const titleWords = words.filter(
    (word) => isTitleCaseWord(word) && !TITLE_CASE_WORD_ALLOWLIST.has(word)
  );
  return titleWords.length >= 2;
}

function visitWithParents(node, visitor, ancestors = []) {
  visitor(node, ancestors);
  for (const child of node.children ?? []) {
    if (child && typeof child === "object") {
      visitWithParents(child, visitor, [...ancestors, node]);
    }
  }
}

export function formatViolations(violations, pageCount) {
  if (violations.length === 0) {
    return `docs-standard: ${pageCount} pages OK`;
  }

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
