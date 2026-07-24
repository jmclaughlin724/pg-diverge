const { parse: parseYaml } = await import("yaml");

const FRONTMATTER_MODES = new Set(["default", "wide", "custom", "frame", "center"]);

const lineOf = (node) => node.position?.start?.line ?? 1;

const pushFrontmatterViolation = (violations, file, msg) => {
  violations.push({ file, line: 1, msg, rule: "frontmatter" });
};

export const readFrontmatter = (tree, file, violations) => {
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
