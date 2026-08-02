import fs from "node:fs";
import path from "node:path";

const docsBaseUrl = "https://supaschema.com/docs";

export function bundleDocsFiles(root) {
  const docsRoot = path.join(root, "docs");
  const sourceFiles = listMdxFiles(docsRoot);
  const files = new Map();

  for (const sourceFile of sourceFiles) {
    files.set(`docs/${sourceFile}`, fs.readFileSync(path.join(docsRoot, sourceFile)));
  }

  const entries = sourceFiles.map((sourceFile) => {
    const route = sourceFile.slice(0, -".mdx".length);
    return `- [agent-bundle/docs/${sourceFile}](${docsBaseUrl}/${route})`;
  });
  files.set(
    "docs/index.md",
    Buffer.from(["# Supaschema Documentation", "", ...entries, ""].join("\n"), "utf8")
  );

  return files;
}

function listMdxFiles(root) {
  const files = [];

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
          continue;
        }
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  };

  visit(root);
  return files.sort();
}
