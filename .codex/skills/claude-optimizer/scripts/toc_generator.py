#!/usr/bin/env python3
"""Insert a compact table of contents into long skill reference files."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def github_anchor(title: str) -> str:
    anchor = title.strip().lower()
    anchor = re.sub(r"[^\w\s-]", "", anchor)
    anchor = re.sub(r"\s+", "-", anchor)
    return anchor


def generate_toc(content: str, min_lines: int) -> str | None:
    lines = content.splitlines()
    if len(lines) < min_lines:
        return None
    headers: list[tuple[int, str, str]] = []
    for line in lines:
        match = re.match(r"^(#{2,3})\s+(.+)$", line)
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            headers.append((level, title, github_anchor(title)))
    if len(headers) < 3:
        return None
    toc = ["## Contents", ""]
    for level, title, anchor in headers:
        indent = "  " * (level - 2)
        toc.append(f"{indent}- [{title}](#{anchor})")
    return "\n".join(toc)


def has_toc(content: str) -> bool:
    return any(line.strip() == "## Contents" for line in content.splitlines()[:30])


def insert_toc(path: Path, min_lines: int, dry_run: bool) -> bool:
    content = path.read_text(encoding="utf-8")
    if has_toc(content):
        print(f"{path}: TOC already present")
        return False
    toc = generate_toc(content, min_lines)
    if toc is None:
        print(f"{path}: no TOC needed")
        return False

    lines = content.splitlines()
    insert_at = 1
    if lines and lines[0].strip() == "---":
        for idx, line in enumerate(lines[1:], 1):
            if line.strip() == "---":
                insert_at = idx + 1
                break
    elif lines and lines[0].startswith("# "):
        insert_at = 1

    new_lines = lines[:insert_at] + ["", toc, ""] + lines[insert_at:]
    if dry_run:
        print(f"{path}: would insert TOC")
        return True
    path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    print(f"{path}: inserted TOC")
    return True


def iter_markdown(path: Path):
    if path.is_file():
        yield path
        return
    for file_path in sorted(path.rglob("*.md")):
        if file_path.name == "SKILL.md":
            continue
        yield file_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate TOCs for long reference files.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--min-lines", type=int, default=120)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.path.exists():
        print(f"Error: path not found: {args.path}", file=sys.stderr)
        return 1
    changed = False
    for markdown in iter_markdown(args.path):
        changed = insert_toc(markdown, args.min_lines, args.dry_run) or changed
    return 0 if changed or args.path.exists() else 1


if __name__ == "__main__":
    sys.exit(main())
