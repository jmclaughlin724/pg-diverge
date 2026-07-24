import { hasMarkdownExtension } from "./paths.mjs";

const DOCS_SITE_HOSTS = new Set(["supaschema.com", "www.supaschema.com"]);
const LOCAL_IMAGE_PREFIX = "/images/";

export const isHttpUrl = (value) => value.startsWith("http://") || value.startsWith("https://");

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
    // Invalid URLs are handled by the caller as non-links.
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

export const addLinkViolation = (violations, file, line, target) => {
  const msg = classifyInternalLink(target);
  if (msg) {
    violations.push({ file, line, msg, rule: "internal-link" });
  }
};

export function inspectImageSrc(src, displayFile, line, violations) {
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
      msg: `local image source "${src}" must live under ${LOCAL_IMAGE_PREFIX}`,
      rule: "image-path",
    });
    return;
  }
  violations.push({
    file: displayFile,
    line,
    msg: `image source "${src}" must be root-relative under ${LOCAL_IMAGE_PREFIX}, e.g. /images/example.png`,
    rule: "image-path",
  });
}
