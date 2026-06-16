#!/usr/bin/env python3
"""Check Codex skill references for shallow progressive disclosure."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def markdown_links(content: str) -> list[str]:
    links: list[str] = []
    for _, target in re.findall(r"\[([^\]]+)\]\(([^)]+)\)", content):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        links.append(target.split("#", 1)[0])
    return links


def check_reference_depth(skill_dir: Path) -> dict[str, object]:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return {"error": "SKILL.md not found"}

    violations: list[dict[str, str]] = []
    content = skill_md.read_text(encoding="utf-8")
    for link in markdown_links(content):
        target = skill_dir / link
        if not target.exists():
            violations.append({"file": "SKILL.md", "link": link, "issue": "broken"})
            continue
        if target.suffix != ".md" or not link.startswith("references/"):
            continue

        ref_content = target.read_text(encoding="utf-8")
        for nested in markdown_links(ref_content):
            if nested.startswith("../"):
                violations.append({"file": link, "link": nested, "issue": "upward-reference"})
                continue
            nested_target = target.parent / nested
            if nested_target.exists() and nested_target.suffix == ".md" and "/" in nested:
                violations.append({"file": link, "link": nested, "issue": "nested-reference"})

    return {"skill": str(skill_dir), "violations": violations}


def print_report(result: dict[str, object]) -> None:
    if "error" in result:
        print(f"Error: {result['error']}")
        return
    violations = result["violations"]
    print("# Reference Depth Check")
    print(f"Skill: {result['skill']}")
    if not violations:
        print("No reference-depth issues found.")
        return
    for violation in violations:
        print(f"- {violation['file']} -> {violation['link']}: {violation['issue']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check skill reference depth.")
    parser.add_argument("skill_directory", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = check_reference_depth(args.skill_directory)
    print_report(result)
    if "error" in result:
        return 1
    return 2 if result["violations"] else 0


if __name__ == "__main__":
    sys.exit(main())
