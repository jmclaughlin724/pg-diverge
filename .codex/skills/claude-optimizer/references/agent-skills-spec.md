# Agent Skills Specification (Portable)

Official Agent Skills specification defining portable, cross-platform skill format.

> **⚠️ PORTABILITY:** This is the official open standard supported across AI platforms including Claude Code, VS Code Copilot, OpenAI, Cursor, GitHub Copilot, and others. Fields documented here work everywhere that implements the Agent Skills specification.

## Overview

Agent Skills is an open standard released by Anthropic on December 18, 2024. The specification is intentionally minimal and portable across AI platforms.

**Official specification:** [agentskills.io/specification](https://agentskills.io/specification)

## File Structure

```
skill-name/
├── SKILL.md              # Required - YAML frontmatter + Markdown instructions
├── references/           # Optional - supporting documentation
├── scripts/              # Optional - executable utilities
└── assets/               # Optional - templates, resources
```

**Rules:**

- `SKILL.md` is the ONLY required file
- Directory name should match the `name` field in frontmatter (recommended)
- Additional directories are optional and can be nested as needed

## YAML Frontmatter Fields

All frontmatter fields are technically optional per the spec, but `name` and `description` are strongly recommended.

### Required (Recommended)

| Field | Type | Max Length | Description |
| --- | --- | --- | --- |
| `name` | string | 64 chars | Skill identifier (lowercase, hyphens, no reserved) |
| `description` | string | 1024 chars | When/why to invoke (third person) |

### Optional (Portable)

| Field | Type | Max Length | Description |
| --- | --- | --- | --- |
| `license` | string | - | License name or path to license file |
| `compatibility` | string | 500 chars | Environment requirements |
| `allowed-tools` | array | - | Tool access policies (platform-enforced) |
| `metadata` | object | - | Arbitrary key-value mapping |

## Field Specifications

### name

**Requirements:**

- Maximum 64 characters
- Lowercase letters, numbers, hyphens only
- Cannot contain "anthropic" or "claude" (platform-specific restriction)
- Should match parent directory name

**Example:**

```yaml
name: processing-pdfs
```

### description

**Requirements:**

- Maximum 1024 characters
- Third person voice (NOT "you" or "I")
- Must include WHEN to use (triggers)
- Must include WHAT it does (capabilities)
- Cannot contain XML tags (< >)

**Pattern:** `Use when [trigger scenarios] - [capability 1], [capability 2]`

**Example:**

```yaml
description: Use when extracting text from PDF files, filling forms, or merging documents - provides pdfplumber patterns and validation workflows
```

### license

Specifies the license for the skill content.

**Format:** License name or relative path to license file

**Examples:**

```yaml
license: MIT
```

```yaml
license: ./LICENSE.md
```

### compatibility

Describes environment requirements or platform compatibility constraints.

**Max length:** 500 characters

**Example:**

```yaml
compatibility: Requires Python 3.9+, pdfplumber library installed
```

### allowed-tools

Tool access policies enforced by the AI platform.

**Format:** Array of tool names or tool patterns

**Examples:**

```yaml
allowed-tools: [Read, Grep, Glob]
```

```yaml
allowed-tools:
  - Read
  - Bash(git:*)
  - mcp__*
```

**Note:** Tool names and patterns are platform-specific. Check your platform's documentation for available tools.

### metadata

Arbitrary key-value mapping for additional metadata.

**Format:** YAML object (any structure)

**Example:**

```yaml
metadata:
  author: Engineering Team
  version: "1.2.0"
  tags: [pdf, documents, extraction]
  last-updated: 2026-01-27
```

## Validation Rules

### Name Validation

```python
import re

def validate_name(name: str) -> bool:
    if len(name) > 64:
        return False
    if not re.match(r'^[a-z0-9-]+$', name):
        return False
    if 'anthropic' in name or 'claude' in name:
        return False  # Platform-specific
    return True
```

### Description Validation

```python
def validate_description(desc: str) -> bool:
    if len(desc) > 1024:
        return False
    if '<' in desc or '>' in desc:
        return False
    return True
```

### Compatibility Validation

```python
def validate_compatibility(compat: str) -> bool:
    return len(compat) <= 500
```

## Complete Portable Example

```yaml
---
name: database-workflow
description: Use when executing database schema changes - provides idempotent patterns, migration generation, drift detection
license: MIT
compatibility: Requires PostgreSQL 14+, Supabase CLI
allowed-tools: [Read, Bash, Write]
metadata:
  version: "2.1.0"
  author: Platform Team
  category: database
  tags: [postgresql, migrations, supabase]
---
# Database Workflow

Instructions for database schema changes...
```

## Platform Adoption

Agent Skills is supported by:

- **Claude Code** (Anthropic)
- **VS Code Copilot** (Microsoft)
- **GitHub Copilot** (GitHub)
- **Cursor**
- **Atlassian Intelligence**
- **Figma AI**

Partner integrations include: Canva, Stripe, Notion, Zapier

## Compliance Indicator

To mark a skill as compliant with the portable specification, add to metadata:

```yaml
metadata:
  compliance: agent-skills-v1
```

## Migration from Platform-Specific Fields

If your skill uses platform-specific fields (like `disable-model-invocation`, `user-invocable`, `context`, `argument-hint`), see [claude-code-extensions.md](claude-code-extensions.md) for migration guidance.

## Validation Tools

The official `skills-ref` validator is available at:

- **Repository:** [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills)
- **Python package:** `agent-skills` on PyPI

**Usage:**

```bash
pip install agent-skills
agent-skills validate /path/to/skill-name/
```

## Sources

This document is based on the official Agent Skills specification:

- [Agent Skills Specification](https://agentskills.io/specification) - Official specification
- [Agent Skills GitHub Repository](https://github.com/agentskills/agentskills) - Reference implementation
- [Anthropic Skills Repository](https://github.com/anthropics/skills) - Example skills and spec documentation
- [VS Code Agent Skills Documentation](https://code.visualstudio.com/docs/copilot/customization/agent-skills) - Microsoft implementation
- [Agent Skills Issue #249](https://github.com/anthropics/skills/issues/249) - Optional frontmatter field clarification

## See Also

- [claude-code-extensions.md](claude-code-extensions.md) - Claude Code proprietary extensions
- [frontmatter-reference.md](frontmatter-reference.md) - Complete field reference with portability indicators
- [skills-patterns.md](skills-patterns.md) - Skills authoring best practices
