#!/usr/bin/env node
// shfmt — via the maintained `sh-syntax` WASM port of mvdan/sh — owns shell
// formatting. It only formats (no sorting). Defaults to the whole repo (minus
// dependency/build/cache dirs); pass explicit roots with `npm run format:sh -- <dir>`.
import { readFileSync, writeFileSync } from "node:fs";
import { print } from "sh-syntax";
import { collectFiles } from "./lib/walk-files.mjs";

const roots = process.argv.slice(2);
const files = collectFiles(roots.length > 0 ? roots : ["."], ".sh");

let changed = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const formatted = await print(src, { filepath: file, indent: 2, originalText: src });
  if (formatted !== src) {
    writeFileSync(file, formatted);
    changed += 1;
  }
}

process.stdout.write(`shfmt (sh-syntax): formatted ${changed} of ${files.length} shell file(s)\n`);
