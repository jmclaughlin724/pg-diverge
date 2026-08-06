const isDigit = (char) => {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
};

const hasMarkdownExtension = (pathname) => pathname.endsWith(".md") || pathname.endsWith(".mdx");

export { hasMarkdownExtension, isDigit };
