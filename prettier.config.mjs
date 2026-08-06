export default {
  embeddedLanguageFormatting: "auto",
  endOfLine: "lf",
  plugins: ["prettier-plugin-astro"],
  overrides: [
    {
      files: "docs/**/*.astro",
      options: {
        parser: "astro",
      },
    },
    {
      files: "docs/**/*.{md,mdx}",
      options: {
        proseWrap: "preserve",
      },
    },
  ],
  printWidth: 80,
  proseWrap: "never",
  tabWidth: 2,
  trailingComma: "es5",
  useTabs: false,
};
