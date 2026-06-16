#!/usr/bin/env python3
"""Package a Codex skill directory as a deterministic .skill archive."""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

from quick_validate import validate_skill


EXCLUDE_NAMES = {".DS_Store", "__pycache__"}
EXCLUDE_SUFFIXES = {".bak", ".pyc", ".pyo"}
FIXED_ZIP_DATE = (2026, 1, 1, 0, 0, 0)


def should_include(path: Path) -> bool:
    if any(part in EXCLUDE_NAMES for part in path.parts):
        return False
    if path.suffix in EXCLUDE_SUFFIXES:
        return False
    return path.is_file()


def write_file(zipf: zipfile.ZipFile, source: Path, arcname: Path) -> None:
    info = zipfile.ZipInfo(str(arcname).replace("\\", "/"), FIXED_ZIP_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    zipf.writestr(info, source.read_bytes())


def package_skill(skill_dir: Path, output_dir: Path) -> Path:
    skill_dir = skill_dir.resolve()
    output_dir = output_dir.resolve()
    valid, message, _ = validate_skill(skill_dir)
    if not valid:
        raise ValueError(f"skill validation failed: {message}")

    output_dir.mkdir(parents=True, exist_ok=True)
    archive = output_dir / f"{skill_dir.name}.skill"
    with zipfile.ZipFile(archive, "w") as zipf:
        for path in sorted(skill_dir.rglob("*")):
            if should_include(path):
                write_file(zipf, path, path.relative_to(skill_dir.parent))
    return archive


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Package a Codex skill directory.")
    parser.add_argument("skill_directory", type=Path)
    parser.add_argument("output_directory", nargs="?", type=Path, default=Path.cwd())
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.skill_directory.is_dir():
        print(f"Error: not a directory: {args.skill_directory}", file=sys.stderr)
        return 1
    try:
        archive = package_skill(args.skill_directory, args.output_directory)
    except (OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(f"Packaged skill: {archive}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
