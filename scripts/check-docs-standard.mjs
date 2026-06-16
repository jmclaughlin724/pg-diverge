#!/usr/bin/env node
// Enforces the supaschema Mintlify authoring standard. It parses docs as
// Markdown/MDX and lints the resulting syntax tree so headings, links, code
// fences, and JSX components are classified structurally.
//
// Run: npm run docs:lint   (also runs as the first step of `docs:check`)
import { existsSync, globSync, readFileSync } from "node:fs";
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
const DOCS_CONFIG = "docs/docs.json";
const DOCS_SITE_HOSTS = new Set(["supaschema.com", "www.supaschema.com"]);
const MINTLIFY_SCHEMA_URL = "https://mintlify.com/docs.json";
const MINTLIFY_THEMES = new Set([
  "mint",
  "maple",
  "palm",
  "willow",
  "linden",
  "almond",
  "aspen",
  "sequoia",
  "luma",
]);
const MINTLIFY_ICON_LIBRARIES = new Set(["lucide", "fontawesome"]);
const REQUIRED_CONTEXTUAL_OPTIONS = new Set([
  "copy",
  "view",
  "chatgpt",
  "claude",
  "mcp",
  "add-mcp",
  "cursor",
  "vscode",
]);
const HTTP_URL_PATTERN = /^https?:\/\//;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const OPENAPI_OPERATION_PATTERN = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+\//;
const DOCS_ROUTE_PREFIX_PATTERN = /^docs\//;
const DOCS_PAGE_EXTENSION_PATTERN = /\.mdx?$/;
const WHITESPACE_PATTERN = /\s+/;
const LOWERCASE_START_PATTERN = /^[a-z0-9]/;
const LOWERCASE_WORD_PATTERN = /^[a-z]/;
const WORD_EDGE_PUNCTUATION_PATTERN = /^[^\w.-]+|[^\w.-]+$/g;
const TITLE_CASE_WORD_PATTERN = /^[A-Z][a-z]+/;
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

const isMdxJsxNode = (node) =>
  node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

const isMdxJsxNamed = (node, name) => isMdxJsxNode(node) && node.name === name;

const hasMarkdownExtension = (pathname) => pathname.endsWith(".md") || pathname.endsWith(".mdx");

const routeForDocFile = (file) =>
  file.replace(DOCS_ROUTE_PREFIX_PATTERN, "").replace(DOCS_PAGE_EXTENSION_PATTERN, "");

const hasDocPageFile = (rootDir, page) =>
  existsSync(join(rootDir, "docs", `${page}.mdx`)) ||
  existsSync(join(rootDir, "docs", `${page}.md`));

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
    return;
  }

  try {
    const url = new URL(trimmed);
    if (isDocsSiteUrl(url)) {
      return `link "${trimmed}" - use a root-relative path (e.g. /commands/diff), not the absolute docs URL`;
    }
    return;
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

const wordCount = (text) => text.trim().split(WHITESPACE_PATTERN).filter(Boolean).length;

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
  if (
    !Array.isArray(data.keywords) ||
    data.keywords.length === 0 ||
    !data.keywords.every((keyword) => typeof keyword === "string" && keyword.trim().length > 0)
  ) {
    violations.push({
      file,
      line: 1,
      rule: "frontmatter",
      msg: "missing or invalid `keywords` array",
    });
  }
  for (const field of ["sidebarTitle", "icon", "iconType", "tag", "api", "openapi", "url"]) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      violations.push({
        file,
        line: 1,
        rule: "frontmatter",
        msg: `\`${field}\` must be a string when present`,
      });
    }
  }
  for (const field of ["noindex", "timestamp"]) {
    if (data[field] !== undefined && typeof data[field] !== "boolean") {
      violations.push({
        file,
        line: 1,
        rule: "frontmatter",
        msg: `\`${field}\` must be a boolean when present`,
      });
    }
  }
  if (data.hidden !== undefined && data.hidden !== true) {
    violations.push({
      file,
      line: 1,
      rule: "frontmatter",
      msg: "`hidden` must be true when present; omit it instead of setting false",
    });
  }
  if (data.mode !== undefined && !FRONTMATTER_MODES.has(data.mode)) {
    violations.push({
      file,
      line: 1,
      rule: "frontmatter",
      msg: "`mode` must be one of default, wide, custom, frame, or center",
    });
  }
  return data;
};

export function lintDocsStandard({ rootDir = process.cwd(), files } = {}) {
  const relativeFiles = (files ?? globSync(DOCS_GLOB, { cwd: rootDir })).map(toPosix).sort();
  const violations = [];
  const frontmatterByRoute = new Map();

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

  return violations;
}

function inspectDocNode(node, displayFile, violations, state) {
  inspectHeading(node, displayFile, violations, state);
  inspectCodeFence(node, displayFile, violations);
  inspectMarkdownLink(node, displayFile, violations);
  inspectMdxNode(node, displayFile, violations, state);
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
  const text = nodeText(node).trim().toLowerCase().replace(/\s+/g, " ");
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
  if (typeof src !== "string" || src.startsWith("#") || HTTP_URL_PATTERN.test(src)) {
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
    LOWERCASE_START_PATTERN.test(normalized) ||
    normalized.startsWith("SUPA_")
  ) {
    return false;
  }

  const words = normalized
    .split(WHITESPACE_PATTERN)
    .map((word) => word.replace(WORD_EDGE_PUNCTUATION_PATTERN, ""))
    .filter(Boolean);
  if (words.length < 2) {
    return false;
  }
  if (
    words
      .slice(1)
      .some(
        (word) =>
          LOWERCASE_WORD_PATTERN.test(word) &&
          !["and", "or", "to", "of", "in", "with", "for"].includes(word)
      )
  ) {
    return false;
  }

  const titleWords = words.filter(
    (word) => TITLE_CASE_WORD_PATTERN.test(word) && !TITLE_CASE_WORD_ALLOWLIST.has(word)
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

function inspectDocsJson(
  rootDir,
  relativeFiles,
  frontmatterByRoute,
  violations,
  { requireConfig }
) {
  const absoluteConfig = join(rootDir, DOCS_CONFIG);
  if (!existsSync(absoluteConfig)) {
    if (requireConfig && relativeFiles.some((file) => file.startsWith("docs/"))) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        rule: "docs-json",
        msg: "`docs/docs.json` is required for the Mintlify site",
      });
    }
    return;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(absoluteConfig, "utf8"));
  } catch (error) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: `docs.json is not valid JSON: ${error.message}`,
    });
    return;
  }

  inspectDocsJsonShape(config, violations);
  inspectDocsJsonNavigation(config, rootDir, relativeFiles, frontmatterByRoute, violations);
}

function inspectDocsJsonShape(config, violations) {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: "`docs.json` must be a JSON object",
    });
    return;
  }

  if (config.$schema !== MINTLIFY_SCHEMA_URL) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: `set "$schema" to "${MINTLIFY_SCHEMA_URL}"`,
    });
  }
  if (typeof config.theme !== "string" || !MINTLIFY_THEMES.has(config.theme)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: "`theme` must be a supported Mintlify theme",
    });
  }
  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    violations.push({ file: DOCS_CONFIG, line: 1, rule: "docs-json", msg: "missing `name`" });
  }
  if (
    !config.navigation ||
    typeof config.navigation !== "object" ||
    Array.isArray(config.navigation)
  ) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: "missing `navigation` object",
    });
  }
  if (!config.colors || typeof config.colors !== "object" || Array.isArray(config.colors)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: "missing `colors.primary`",
    });
  } else {
    for (const key of ["primary", "light", "dark"]) {
      if (key === "primary" || config.colors[key] !== undefined) {
        inspectHexColor(config.colors[key], `colors.${key}`, violations);
      }
    }
  }
  const iconLibrary = config.icons?.library;
  if (iconLibrary !== undefined && !MINTLIFY_ICON_LIBRARIES.has(iconLibrary)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: '`icons.library` must be either "lucide" or "fontawesome"',
    });
  }
  inspectContextualOptions(config, violations);
}

function inspectHexColor(value, path, violations) {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: `\`${path}\` must be a hex color starting with #`,
    });
  }
}

function inspectContextualOptions(config, violations) {
  if (
    !config.contextual ||
    typeof config.contextual !== "object" ||
    Array.isArray(config.contextual)
  ) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: "`contextual.options` must be configured for Mintlify AI/MCP actions",
    });
    return;
  }
  if (!Array.isArray(config.contextual.options)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      rule: "docs-json",
      msg: "`contextual.options` must be an array",
    });
    return;
  }

  const configured = new Set(
    config.contextual.options.filter((option) => typeof option === "string")
  );
  for (const option of REQUIRED_CONTEXTUAL_OPTIONS) {
    if (!configured.has(option)) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        rule: "docs-json",
        msg: `contextual.options is missing "${option}" for Mintlify AI/MCP actions`,
      });
    }
  }
}

function inspectDocsJsonNavigation(config, rootDir, relativeFiles, frontmatterByRoute, violations) {
  const pageFiles = new Set(relativeFiles.map(routeForDocFile));
  const navRefs = collectNavigationPageRefs(config.navigation);
  const navPages = new Set(navRefs.filter((page) => !OPENAPI_OPERATION_PATTERN.test(page)));

  for (const page of navPages) {
    if (page.startsWith("/") || page.startsWith("docs/") || hasMarkdownExtension(page)) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        rule: "navigation",
        msg: `navigation page "${page}" must be extensionless and relative to docs root`,
      });
      continue;
    }
    if (!hasDocPageFile(rootDir, page)) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        rule: "navigation",
        msg: `navigation page "${page}" does not resolve to docs/${page}.md or docs/${page}.mdx`,
      });
    }
  }

  for (const page of pageFiles) {
    const frontmatter = frontmatterByRoute.get(page);
    if (frontmatter?.hidden === true || frontmatter?.url) {
      continue;
    }
    if (!navPages.has(page)) {
      violations.push({
        file: `docs/${page}`,
        line: 1,
        rule: "navigation",
        msg: "navigable page is missing from docs.json navigation; add it to navigation or set `hidden: true`",
      });
    }
  }

  for (const label of collectNavigationLabels(config.navigation)) {
    if (label.value.includes("\n") || label.value.length > 48) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        rule: "navigation-label",
        msg: `${label.key} label "${label.value}" must be short enough for a one- or two-line navigation item`,
      });
    }
  }
}

function collectNavigationPageRefs(value, refs = []) {
  if (typeof value === "string") {
    refs.push(value);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNavigationPageRefs(item, refs);
    }
    return refs;
  }
  if (!value || typeof value !== "object") {
    return refs;
  }
  if (typeof value.page === "string") {
    refs.push(value.page);
  }
  if (Array.isArray(value.pages)) {
    collectNavigationPageRefs(value.pages, refs);
  }
  for (const key of [
    "groups",
    "tabs",
    "anchors",
    "dropdowns",
    "products",
    "versions",
    "languages",
    "menu",
  ]) {
    if (value[key] !== undefined) {
      collectNavigationPageRefs(value[key], refs);
    }
  }
  if (value.global !== undefined) {
    collectNavigationPageRefs(value.global, refs);
  }
  return refs;
}

function collectNavigationLabels(value, labels = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNavigationLabels(item, labels);
    }
    return labels;
  }
  if (!value || typeof value !== "object") {
    return labels;
  }
  for (const key of ["group", "tab", "anchor", "dropdown", "product", "item", "version"]) {
    if (typeof value[key] === "string") {
      labels.push({ key, value: value[key] });
    }
  }
  for (const key of [
    "groups",
    "tabs",
    "anchors",
    "dropdowns",
    "products",
    "versions",
    "languages",
    "menu",
  ]) {
    if (value[key] !== undefined) {
      collectNavigationLabels(value[key], labels);
    }
  }
  if (value.global !== undefined) {
    collectNavigationLabels(value.global, labels);
  }
  return labels;
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
