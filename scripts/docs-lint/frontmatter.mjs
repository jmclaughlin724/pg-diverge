const { parse: parseYaml } = await import("yaml");

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
  for (const field of ["slug", "type", "date", "lastModified"]) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      pushFrontmatterViolation(violations, file, `\`${field}\` must be a string when present`);
    }
  }
  for (const field of ["draft", "hidden"]) {
    if (data[field] !== undefined && typeof data[field] !== "boolean") {
      pushFrontmatterViolation(violations, file, `\`${field}\` must be a boolean when present`);
    }
  }
  for (const field of ["sidebar", "seo", "search"]) {
    const value = data[field];
    if (
      value !== undefined &&
      (typeof value !== "object" || value === null || Array.isArray(value))
    ) {
      pushFrontmatterViolation(violations, file, `\`${field}\` must be a mapping when present`);
    }
  }
};
