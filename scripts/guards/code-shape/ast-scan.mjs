import { ts } from "../lib/ast-utils.js";

export const forbiddenSurfaceNameTerms = [
  "alias",
  "compat",
  "compatibility",
  "deprecated",
  "dto",
  "facade",
  "legacy",
  "shim",
  "view-model",
  "viewmodel",
  "wrapper",
];

export function jsTsStringValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("");
  }
}

export function jsTsSearchableValue(node) {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  return jsTsStringValue(node);
}
