#!/usr/bin/env python3
"""Validate a Codex-oriented skill directory."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import strictyaml
except ImportError:
    strictyaml = None


MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 900
MAX_SKILL_LINES = 500
CODEX_FIELDS = {
    "name",
    "description",
    "metadata",
    "validate",
    "chainTo",
    "retrieval",
    "argument-hint",
    "user-invocable",
    "disable-model-invocation",
    "allowed-tools",
    "license",
    "compatibility",
}
CLAUDE_ONLY_HINTS = {"when_to_use", "context", "agent", "hooks", "effort", "shell", "paths"}


@dataclass(frozen=True)
class FixResult:
    field: str
    original: str
    fixed: str
    applied: bool = False


def normalize_name(name: str) -> str:
    name = unicodedata.normalize("NFKC", name.strip())
    name = re.sub(r"[_\s]+", "-", name)
    name = re.sub(r"(.)([A-Z][a-z]+)", r"\1-\2", name)
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", name)
    name = re.sub(r"-+", "-", name.lower()).strip("-")
    return name


def normalize_description(description: str) -> str:
    description = description.strip().replace("<", "").replace(">", "")
    return re.sub(r"\s+", " ", description)


def split_frontmatter(content: str) -> tuple[str, str] | None:
    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        return None
    return match.group(1), match.group(2)


def load_frontmatter(skill_md: Path) -> tuple[dict[str, Any] | None, str | None, str | None]:
    if strictyaml is None:
        return (
            None,
            None,
            "strictyaml is required. Install with: pip install -r scripts/requirements.txt",
        )

    content = skill_md.read_text(encoding="utf-8")
    split = split_frontmatter(content)
    if split is None:
        return None, None, "SKILL.md must start with YAML frontmatter"
    frontmatter_text, body = split
    try:
        parsed = strictyaml.load(frontmatter_text).data
    except strictyaml.YAMLError as exc:
        return None, None, f"Invalid YAML frontmatter: {exc}"
    if not isinstance(parsed, dict):
        return None, None, "Frontmatter must be a mapping"
    return parsed, body, None


def markdown_links(content: str) -> list[str]:
    links: list[str] = []
    for _, target in re.findall(r"\[([^\]]+)\]\(([^)]+)\)", content):
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        links.append(target.split("#", 1)[0])
    return links


def is_scalar(value: Any) -> bool:
    return isinstance(value, (str, int, float, bool)) or value is None


def metadata_is_valid(value: Any) -> bool:
    if isinstance(value, dict):
        return all(isinstance(k, str) and metadata_is_valid(v) for k, v in value.items())
    if isinstance(value, list):
        return all(metadata_is_valid(item) for item in value)
    return is_scalar(value)


def validate_skill(skill_path: Path | str, apply_fix: bool = False, dry_run: bool = False):
    skill_path = Path(skill_path)
    skill_md = skill_path / "SKILL.md"
    errors: list[str] = []
    warnings: list[str] = []
    fixes: list[FixResult] = []

    if not skill_path.is_dir():
        return False, f"Skill directory not found: {skill_path}", fixes
    if not skill_md.exists():
        return False, "SKILL.md not found", fixes

    frontmatter, body, error = load_frontmatter(skill_md)
    if error:
        return False, error, fixes
    assert frontmatter is not None
    assert body is not None

    name = frontmatter.get("name", skill_path.name)
    if not isinstance(name, str) or not name.strip():
        errors.append("Frontmatter name must be a non-empty string")
    else:
        normalized = normalize_name(name)
        if normalized != name:
            fixes.append(FixResult("name", name, normalized))
            errors.append(f"name should be kebab-case: {name}")
        if len(normalized) > MAX_NAME_LENGTH:
            errors.append(f"name exceeds {MAX_NAME_LENGTH} characters")
        if skill_path.name != normalized:
            fixes.append(FixResult("directory", str(skill_path), str(skill_path.parent / normalized)))
            errors.append(f"directory name must match skill name: {normalized}")

    description = frontmatter.get("description")
    if not isinstance(description, str) or not description.strip():
        errors.append("description is required and must be non-empty")
    else:
        normalized_description = normalize_description(description)
        if normalized_description != description:
            fixes.append(FixResult("description", description, normalized_description))
            errors.append("description should not contain angle brackets or repeated whitespace")
        if len(normalized_description) > MAX_DESCRIPTION_LENGTH:
            warnings.append(
                f"description is {len(normalized_description)} characters; keep discovery text concise"
            )
        if not normalized_description.lower().startswith("use when"):
            warnings.append('description should usually start with "Use when"')

    unexpected = sorted(set(frontmatter) - CODEX_FIELDS - CLAUDE_ONLY_HINTS)
    if unexpected:
        warnings.append(f"unexpected frontmatter keys: {', '.join(unexpected)}")
    claude_only = sorted(set(frontmatter) & CLAUDE_ONLY_HINTS)
    if claude_only:
        warnings.append(f"Claude-specific fields present in Codex-oriented skill: {', '.join(claude_only)}")

    metadata = frontmatter.get("metadata")
    if metadata is not None and not metadata_is_valid(metadata):
        errors.append("metadata must contain only strings, numbers, booleans, lists, or mappings")

    lines = skill_md.read_text(encoding="utf-8").splitlines()
    if len(lines) > MAX_SKILL_LINES:
        errors.append(f"SKILL.md has {len(lines)} lines; maximum is {MAX_SKILL_LINES}")
    if "todo" in skill_md.read_text(encoding="utf-8").lower():
        warnings.append("TODO marker found")

    for link in markdown_links(body):
        target = (skill_path / link).resolve()
        if not target.exists():
            errors.append(f"broken link: {link}")
        elif "references" in target.parts and target.suffix == ".md":
            rel_parts = Path(link).parts
            if len(rel_parts) > 2 and rel_parts[0] == "references":
                warnings.append(f"nested reference path should be avoided: {link}")

    openai_yaml = skill_path / "agents" / "openai.yaml"
    if openai_yaml.exists():
        try:
            strictyaml.load(openai_yaml.read_text(encoding="utf-8"))
        except strictyaml.YAMLError as exc:
            errors.append(f"agents/openai.yaml is invalid YAML: {exc}")

    if apply_fix and fixes:
        success, applied = apply_fixes(skill_path, fixes, dry_run=dry_run)
        if not success:
            return False, "Failed to apply fixes", fixes
        if dry_run:
            return False, format_message(errors, warnings, applied), applied
        return validate_skill(skill_path, apply_fix=False)

    return not errors, format_message(errors, warnings, fixes), fixes


def apply_fixes(skill_path: Path, fixes: list[FixResult], dry_run: bool = False) -> tuple[bool, list[FixResult]]:
    skill_md = skill_path / "SKILL.md"
    content = skill_md.read_text(encoding="utf-8")
    split = split_frontmatter(content)
    if split is None:
        return False, []
    frontmatter_text, body = split
    directory_fix: FixResult | None = None
    applied: list[FixResult] = []

    for fix in fixes:
        if fix.field == "directory":
            directory_fix = fix
            continue
        if fix.field == "name":
            frontmatter_text = re.sub(
                r"^(name:\s*)[^\n]+",
                lambda match: f"{match.group(1)}{fix.fixed}",
                frontmatter_text,
                flags=re.MULTILINE,
            )
            applied.append(FixResult(fix.field, fix.original, fix.fixed, not dry_run))
        if fix.field == "description":
            frontmatter_text = re.sub(
                r"^(description:\s*).*$",
                lambda match: f"{match.group(1)}{json.dumps(fix.fixed)}",
                frontmatter_text,
                flags=re.MULTILINE,
            )
            applied.append(FixResult(fix.field, fix.original, fix.fixed, not dry_run))

    if dry_run:
        if directory_fix:
            applied.append(FixResult(directory_fix.field, directory_fix.original, directory_fix.fixed, False))
        return True, applied

    shutil.copy2(skill_md, skill_md.with_suffix(".md.bak"))
    skill_md.write_text(f"---\n{frontmatter_text}\n---\n{body}", encoding="utf-8")
    if directory_fix:
        old_path = Path(directory_fix.original)
        new_path = Path(directory_fix.fixed)
        if old_path.exists() and not new_path.exists():
            shutil.move(str(old_path), str(new_path))
            applied.append(FixResult("directory", str(old_path), str(new_path), True))
    return True, applied


def format_message(errors: list[str], warnings: list[str], fixes: list[FixResult]) -> str:
    parts: list[str] = []
    if errors:
        parts.append("Errors:")
        parts.extend(f"- {error}" for error in errors)
    if warnings:
        parts.append("Warnings:")
        parts.extend(f"- {warning}" for warning in warnings)
    if fixes:
        parts.append("Fixable:")
        parts.extend(f"- {fix.field}: {fix.original!r} -> {fix.fixed!r}" for fix in fixes)
    if not parts:
        return "Skill is structurally valid for Codex use."
    return "\n".join(parts)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a Codex-oriented skill directory.")
    parser.add_argument("skill_directory", type=Path)
    parser.add_argument("--fix", action="store_true", help="Apply safe frontmatter fixes")
    parser.add_argument("--dry-run", action="store_true", help="Show fixes without writing")
    parser.add_argument("--quiet", "-q", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.dry_run and not args.fix:
        print("Error: --dry-run requires --fix", file=sys.stderr)
        return 1
    valid, message, _ = validate_skill(args.skill_directory, apply_fix=args.fix, dry_run=args.dry_run)
    if message and (not args.quiet or not valid):
        print(message)
    return 0 if valid else 1


if __name__ == "__main__":
    sys.exit(main())
