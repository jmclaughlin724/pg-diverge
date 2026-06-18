#!/usr/bin/env python3
"""Initialize a Codex-optimized skill skeleton."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def validate_skill_name(name: str) -> str:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        raise ValueError("skill name must be lowercase kebab-case")
    if len(name) > 64:
        raise ValueError("skill name must be 64 characters or fewer")
    return name


def title_from_name(name: str) -> str:
    return " ".join(part.capitalize() for part in name.split("-"))


def skill_template(name: str, title: str) -> str:
    return f"""---
name: {name}
description: "Use when [specific trigger]. Delivers [outcome] by [approach] while preserving [constraint]."
metadata:
  keywords:
    - "{name}"
---

# {title}

Use this skill for [bounded workflow].

## Source Order

1. Read live repo files before relying on memory.
2. Use upstream official docs for external product facts.
3. Apply repo owner rules after upstream behavior is understood.

## Workflow

1. Identify the controlling objective and acceptance criteria.
2. Classify the owner surface before editing.
3. Reach the smallest correct end state.
4. Run the closeout command for the touched owner.
5. Report owner changed, proof run, and blockers inside scope.

## Reference Map

| Need | Reference |
| --- | --- |
| Delivery workflow | [`references/workflow.md`](references/workflow.md) |
"""


def reference_template(title: str) -> str:
    return f"""# {title} Workflow

## Intent

Use this reference when [specific surface or scenario].

## Authoring Steps

1. [Action]
2. [Action]
3. [Action]

## Avoid

- [Wrong owner or anti-pattern]

## Closeout

- Run the closeout command for the touched owner.
"""


def openai_yaml_template(title: str) -> str:
    return f"""interface:
  display_name: {title}
policy:
  allow_implicit_invocation: true
dependencies:
  tools: []
"""


def script_template(name: str) -> str:
    return f"""#!/usr/bin/env python3
\"\"\"Deterministic helper for {name}.\"\"\"


def main() -> int:
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""


def init_skill(
    name: str,
    root: Path,
    with_reference: bool,
    with_script: bool,
    with_openai_metadata: bool,
) -> Path:
    validate_skill_name(name)
    skill_dir = (root / name).resolve()
    if skill_dir.exists():
        raise FileExistsError(f"skill directory already exists: {skill_dir}")

    title = title_from_name(name)
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(skill_template(name, title), encoding="utf-8")

    if with_reference:
        refs = skill_dir / "references"
        refs.mkdir()
        (refs / "workflow.md").write_text(reference_template(title), encoding="utf-8")

    if with_script:
        scripts = skill_dir / "scripts"
        scripts.mkdir()
        helper = scripts / "helper.py"
        helper.write_text(script_template(name), encoding="utf-8")
        helper.chmod(0o755)

    if with_openai_metadata:
        agents = skill_dir / "agents"
        agents.mkdir()
        (agents / "openai.yaml").write_text(openai_yaml_template(title), encoding="utf-8")

    return skill_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a Codex-optimized skill skeleton.")
    parser.add_argument("skill_name")
    parser.add_argument("--path", required=True, type=Path, help="Root directory that will contain the skill")
    parser.add_argument("--with-reference", action="store_true", help="Create references/workflow.md")
    parser.add_argument("--with-script", action="store_true", help="Create scripts/helper.py")
    parser.add_argument(
        "--with-openai-metadata",
        action="store_true",
        help="Create agents/openai.yaml",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        skill_dir = init_skill(
            args.skill_name,
            args.path,
            args.with_reference,
            args.with_script,
            args.with_openai_metadata,
        )
    except (OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Created skill: {skill_dir}")
    print("Next steps:")
    print("1. Replace bracketed placeholders with concrete workflow instructions.")
    print("2. Keep SKILL.md focused on the normal path; move variants into references.")
    print("3. For supaschema skill-source edits, run: npm run sync:llm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
