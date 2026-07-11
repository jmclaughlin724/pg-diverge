import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hasMarkdownExtension, isDigit, routeForDocFile } from "./paths.mjs";

const DOCS_CONFIG = "docs/docs.json";
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

const isHexColor = (value) => {
  if (!((value.length === 4 || value.length === 7) && value.startsWith("#"))) {
    return false;
  }
  return [...value.slice(1)].every(isHexDigit);
};

const isHexDigit = (char) => isDigit(char) || "abcdefABCDEF".includes(char);

const isOpenApiOperationRef = (value) => {
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
  const space = value.indexOf(" ");
  return (
    space > 0 && methods.includes(value.slice(0, space)) && value.slice(space + 1).startsWith("/")
  );
};

const hasDocPageFile = (rootDir, page) =>
  existsSync(join(rootDir, "docs", `${page}.mdx`)) ||
  existsSync(join(rootDir, "docs", `${page}.md`));

export function inspectDocsJson(
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
        msg: "`docs/docs.json` is required for the Mintlify site",
        rule: "docs-json",
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
      msg: `docs.json is not valid JSON: ${error.message}`,
      rule: "docs-json",
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
      msg: "`docs.json` must be a JSON object",
      rule: "docs-json",
    });
    return;
  }

  if (config.$schema !== MINTLIFY_SCHEMA_URL) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      msg: `set "$schema" to "${MINTLIFY_SCHEMA_URL}"`,
      rule: "docs-json",
    });
  }
  if (typeof config.theme !== "string" || !MINTLIFY_THEMES.has(config.theme)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      msg: "`theme` must be a supported Mintlify theme",
      rule: "docs-json",
    });
  }
  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    violations.push({ file: DOCS_CONFIG, line: 1, msg: "missing `name`", rule: "docs-json" });
  }
  if (
    !config.navigation ||
    typeof config.navigation !== "object" ||
    Array.isArray(config.navigation)
  ) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      msg: "missing `navigation` object",
      rule: "docs-json",
    });
  }
  if (!config.colors || typeof config.colors !== "object" || Array.isArray(config.colors)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      msg: "missing `colors.primary`",
      rule: "docs-json",
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
      msg: '`icons.library` must be either "lucide" or "fontawesome"',
      rule: "docs-json",
    });
  }
  inspectContextualOptions(config, violations);
}

function inspectHexColor(value, path, violations) {
  if (typeof value !== "string" || !isHexColor(value)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      msg: `\`${path}\` must be a hex color starting with #`,
      rule: "docs-json",
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
      msg: "`contextual.options` must be configured for Mintlify AI/MCP actions",
      rule: "docs-json",
    });
    return;
  }
  if (!Array.isArray(config.contextual.options)) {
    violations.push({
      file: DOCS_CONFIG,
      line: 1,
      msg: "`contextual.options` must be an array",
      rule: "docs-json",
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
        msg: `contextual.options is missing "${option}" for Mintlify AI/MCP actions`,
        rule: "docs-json",
      });
    }
  }
}

function inspectDocsJsonNavigation(config, rootDir, relativeFiles, frontmatterByRoute, violations) {
  const pageFiles = new Set(relativeFiles.map(routeForDocFile));
  const navRefs = collectNavigationPageRefs(config.navigation);
  const navPages = new Set(navRefs.filter((page) => !isOpenApiOperationRef(page)));

  for (const page of navPages) {
    if (page.startsWith("/") || page.startsWith("docs/") || hasMarkdownExtension(page)) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        msg: `navigation page "${page}" must be extensionless and relative to docs root`,
        rule: "navigation",
      });
      continue;
    }
    if (!hasDocPageFile(rootDir, page)) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        msg: `navigation page "${page}" does not resolve to docs/${page}.md or docs/${page}.mdx`,
        rule: "navigation",
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
        msg: "navigable page is missing from docs.json navigation; add it to navigation or set `hidden: true`",
        rule: "navigation",
      });
    }
  }

  for (const label of collectNavigationLabels(config.navigation)) {
    if (label.value.includes("\n") || label.value.length > 48) {
      violations.push({
        file: DOCS_CONFIG,
        line: 1,
        msg: `${label.key} label "${label.value}" must be short enough for a one- or two-line navigation item`,
        rule: "navigation-label",
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
