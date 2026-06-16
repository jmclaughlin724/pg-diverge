#!/usr/bin/env python3
"""Analyze a Codex skill for progressive-disclosure quality.

This script is advisory. It reads SKILL.md and direct references, then reports
whether the skill is concise, actionable, and structured for Codex discovery.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import tiktoken

    HAS_TIKTOKEN = True
except ImportError:
    HAS_TIKTOKEN = False


BODY_TARGET_TOKENS = 1800
BODY_WARNING_TOKENS = 3500
BODY_MAX_TOKENS = 5000
SKILL_MAX_LINES = 500
REFERENCE_MAX_LINES = 140


def count_tokens(text: str) -> int:
    if HAS_TIKTOKEN:
        encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    return max(1, len(text) // 4)


def split_frontmatter(content: str) -> tuple[str, str] | None:
    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        return None
    return match.group(1), match.group(2)


def markdown_links(content: str) -> list[str]:
    links: list[str] = []
    for _, target in re.findall(r"\[([^\]]+)\]\(([^)]+)\)", content):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        links.append(target.split("#", 1)[0])
    return links


def headings(content: str) -> set[str]:
    found: set[str] = set()
    for line in content.splitlines():
        match = re.match(r"^#{2,3}\s+(.+?)\s*$", line)
        if match:
            found.add(match.group(1).strip().lower())
    return found


def classify_body_tokens(tokens: int) -> str:
    if tokens < BODY_TARGET_TOKENS:
        return "excellent"
    if tokens < BODY_WARNING_TOKENS:
        return "good"
    if tokens < BODY_MAX_TOKENS:
        return "warning"
    return "over_limit"


def analyze_references(skill_dir: Path, body: str) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for link in sorted(set(markdown_links(body))):
        if not link.startswith("references/"):
            continue
        ref_path = skill_dir / link
        if not ref_path.exists():
            results.append({"path": link, "status": "missing"})
            continue
        if ref_path.suffix != ".md":
            continue
        content = ref_path.read_text(encoding="utf-8")
        ref_headings = headings(content)
        action_sections = {
            "intent",
            "workflow",
            "authoring rules",
            "authoring steps",
            "delivery pattern",
            "supaschema delivery pattern",
            "closeout",
            "checklist",
        }
        results.append(
            {
                "path": link,
                "status": "present",
                "lines": len(content.splitlines()),
                "tokens": count_tokens(content),
                "actionable": bool(ref_headings & action_sections),
            }
        )
    return results


def analyze_skill(skill_dir: Path) -> dict[str, object]:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return {"error": "SKILL.md not found"}

    content = skill_md.read_text(encoding="utf-8")
    split = split_frontmatter(content)
    if split is None:
        return {"error": "SKILL.md must start with YAML frontmatter"}

    frontmatter, body = split
    body_tokens = count_tokens(body)
    frontmatter_tokens = count_tokens(frontmatter)
    references = analyze_references(skill_dir, body)
    skill_lines = len(content.splitlines())

    issues: list[str] = []
    if skill_lines > SKILL_MAX_LINES:
        issues.append(f"SKILL.md has {skill_lines} lines; target is <= {SKILL_MAX_LINES}.")
    if body_tokens >= BODY_MAX_TOKENS:
        issues.append(f"SKILL.md body has about {body_tokens} tokens; move detail to references.")
    if "todo" in content.lower():
        issues.append("TODO marker found in skill content.")
    if not references and "references/" in body:
        issues.append("Reference links were expected but not resolved.")
    for ref in references:
        if ref["status"] == "missing":
            issues.append(f"Missing reference: {ref['path']}")
        elif ref.get("lines", 0) > REFERENCE_MAX_LINES:
            issues.append(f"Reference is large: {ref['path']} has {ref['lines']} lines.")
        elif not ref.get("actionable"):
            issues.append(f"Reference may be summary-only: {ref['path']}")

    return {
        "skill": str(skill_dir),
        "frontmatter_tokens": frontmatter_tokens,
        "body_tokens": body_tokens,
        "body_status": classify_body_tokens(body_tokens),
        "line_count": skill_lines,
        "references": references,
        "issues": issues,
        "using_tiktoken": HAS_TIKTOKEN,
    }


def print_report(result: dict[str, object]) -> None:
    if "error" in result:
        print(f"Error: {result['error']}")
        return

    print("# Codex Skill Analysis")
    print()
    print(f"Skill: {result['skill']}")
    print(f"SKILL.md lines: {result['line_count']}")
    print(f"Frontmatter tokens: {result['frontmatter_tokens']}")
    print(f"Body tokens: {result['body_tokens']} ({result['body_status']})")
    if not result["using_tiktoken"]:
        print("Token counts are estimated; install tiktoken for exact counts.")
    print()

    refs = result["references"]
    if refs:
        print("## References")
        for ref in refs:
            if ref["status"] == "missing":
                print(f"- {ref['path']}: missing")
            else:
                action = "actionable" if ref.get("actionable") else "needs action sections"
                print(f"- {ref['path']}: {ref['lines']} lines, {action}")
        print()

    issues = result["issues"]
    if issues:
        print("## Issues")
        for issue in issues:
            print(f"- {issue}")
    else:
        print("No structural issues found.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze a Codex skill directory.")
    parser.add_argument("skill_directory", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.skill_directory.is_dir():
        print(f"Error: not a directory: {args.skill_directory}")
        return 1
    result = analyze_skill(args.skill_directory)
    print_report(result)
    if "error" in result:
        return 1
    return 2 if result.get("issues") else 0


if __name__ == "__main__":
    sys.exit(main())
