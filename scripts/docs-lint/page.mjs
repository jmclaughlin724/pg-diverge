import { toString as nodeText } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { inspectAdjacentCallouts, inspectImageFrame, inspectMdxNode } from "./components.mjs";
import { readFrontmatter } from "./frontmatter.mjs";
import { addLinkViolation, inspectImageSrc, isHttpUrl } from "./links.mjs";
import { isDigit } from "./paths.mjs";

const COMPARISON_PREFIX = "docs/comparisons/";
const GENERIC_LINK_TEXT = new Set([
  "click here",
  "here",
  "learn more",
  "read more",
  "this",
  "this page",
]);

const TITLE_CASE_WORD_ALLOWLIST = new Set([
  "AGENTS.md",
  "API",
  "CI",
  "CLI",
  "Codex",
  "GitHub",
  "JSON",
  "Blume",
  "MCP",
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

const lineOf = (node) => node.position?.start?.line ?? 1;

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

const isTitleCaseWord = (word) =>
  word.length >= 2 && isUppercaseAscii(word[0] ?? "") && isLowercaseAscii(word[1] ?? "");

export function inspectDocsPage(text, displayFile, violations) {
  const processor = displayFile.endsWith(".mdx") ? mdxProcessor : markdownProcessor;

  let tree;
  try {
    tree = processor.parse(text);
  } catch (error) {
    violations.push({
      file: displayFile,
      line: error.line ?? 1,
      msg: error.message,
      rule: "parse",
    });
    return;
  }

  const frontmatter = readFrontmatter(tree, displayFile, violations);

  visit(tree, (node) => {
    inspectDocNode(node, displayFile, violations);
  });
  visitWithParents(tree, (node, ancestors) => {
    inspectAdjacentCallouts(node, displayFile, violations);
    inspectImageFrame(node, ancestors, displayFile, violations);
  });
  inspectComparisonPage(tree, displayFile, violations);

  return frontmatter;
}

function inspectDocNode(node, displayFile, violations) {
  inspectHeading(node, displayFile, violations);
  inspectCodeFence(node, displayFile, violations);
  inspectMarkdownLink(node, displayFile, violations);
  inspectMdxNode(node, displayFile, violations);
}

function inspectComparisonPage(tree, displayFile, violations) {
  if (!(displayFile.startsWith(COMPARISON_PREFIX) && displayFile.endsWith(".mdx"))) {
    return;
  }
  if (!hasVerificationDate(nodeText(tree))) {
    violations.push({
      file: displayFile,
      line: 1,
      msg: "comparison pages must include `Last verified YYYY-MM-DD` for external claims",
      rule: "comparison-claim",
    });
  }
  if (!hasSourcedSection(tree)) {
    violations.push({
      file: displayFile,
      line: 1,
      msg: "comparison pages must include a Sources section with at least one outbound link",
      rule: "comparison-claim",
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

function inspectHeading(node, displayFile, violations) {
  if (node.type !== "heading") {
    return;
  }
  const headingText = nodeText(node);
  if (node.depth === 1) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      msg: "drop the body `# ` heading - the frontmatter `title` is the page H1; start in-page headings at `##`",
      rule: "body-h1",
    });
  }
  if (node.depth >= 2 && isObviousTitleCaseHeading(node, headingText)) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      msg: `heading "${headingText}" should use sentence case unless it is a command, acronym, code symbol, product name, or diagnostic code`,
      rule: "heading-case",
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
      msg: "add a code fence language tag (use `text` for terminal output, diagrams, and plain text)",
      rule: "code-fence-language",
    });
  }
  if (typeof node.meta === "string" && node.meta.includes("theme={null}")) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      msg: "remove `theme={null}` from the code fence",
      rule: "fence-artifact",
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

function inspectLinkText(node, displayFile, violations) {
  const text = collapseWhitespace(nodeText(node).trim().toLowerCase());
  if (!GENERIC_LINK_TEXT.has(text)) {
    return;
  }
  violations.push({
    file: displayFile,
    line: lineOf(node),
    msg: `link text "${text}" is too generic; use descriptive text that names the destination`,
    rule: "link-text",
  });
}

function inspectImage(node, displayFile, violations) {
  if (typeof node.alt !== "string" || node.alt.trim().length === 0) {
    violations.push({
      file: displayFile,
      line: lineOf(node),
      msg: "images need descriptive alt text",
      rule: "image-alt",
    });
  }
  inspectImageSrc(node.url, displayFile, lineOf(node), violations);
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
