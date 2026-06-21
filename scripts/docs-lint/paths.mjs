const isDigit = (char) => {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
};

const hasMarkdownExtension = (pathname) => pathname.endsWith(".md") || pathname.endsWith(".mdx");

const stripDocsPrefix = (file) => (file.startsWith("docs/") ? file.slice(5) : file);

const stripMarkdownExtension = (file) => {
  if (file.endsWith(".mdx")) {
    return file.slice(0, -4);
  }
  if (file.endsWith(".md")) {
    return file.slice(0, -3);
  }
  return file;
};

const routeForDocFile = (file) => stripMarkdownExtension(stripDocsPrefix(file));

export { hasMarkdownExtension, isDigit, routeForDocFile };
