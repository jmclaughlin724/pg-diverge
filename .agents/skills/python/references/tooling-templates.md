<tooling_templates> <pyproject_minimal>

```toml
[build-system]
requires = ["setuptools>=77", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "my-package"
version = "0.1.0"
description = "Short description"
readme = "README.md"
requires-python = ">=3.10"
license = "MIT"
license-files = ["LICENSE*"]
dependencies = []

[project.optional-dependencies]
dev = [
  "pytest>=8",
  "pytest-cov>=5",
  "ruff>=0.8",
  "mypy>=1.13",
  "build>=1.2",
]

[tool.setuptools.packages.find]
where = ["src"]
```

</pyproject_minimal>

<ruff_mypy_pytest>

```toml
[tool.ruff]
line-length = 88
target-version = "py310"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "B", "C4", "UP", "SIM", "RUF"]
ignore = ["E501"]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101"]

[tool.mypy]
python_version = "3.10"
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
check_untyped_defs = true
no_implicit_optional = true
warn_redundant_casts = true
warn_unused_ignores = true

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers --strict-config"

[tool.coverage.run]
branch = true
source = ["src/my_package"]
```

</ruff_mypy_pytest>

<commands>
Use repo-owned wrappers first. Generic fallback:

```bash
python -m pip install -e ".[dev]"
ruff check src tests
ruff format src tests
mypy src
pytest
python -m build
```

</commands>

<deprecation_pattern>

```python
import warnings

def old_function(value: str) -> str:
    warnings.warn(
        "old_function() is deprecated; use new_function() instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return new_function(value)
```

</deprecation_pattern>

<pytest_patterns>

```python
import pytest

@pytest.mark.parametrize(
    ("raw", "expected"),
    [pytest.param("a", "A", id="lowercase")],
)
def test_transform(raw: str, expected: str) -> None:
    assert transform(raw) == expected

@pytest.fixture
def make_user():
    def factory(name: str = "Ada") -> User:
        return User(name=name)
    return factory
```

</pytest_patterns>

<hypothesis_pattern>

```python
from hypothesis import given, strategies as st

@given(st.text())
def test_round_trip(value: str) -> None:
    assert decode(encode(value)) == value
```

</hypothesis_pattern>

<sphinx_core>

```python
# docs/conf.py
extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "myst_parser",
]
html_theme = "furo"
```

</sphinx_core>

<security_commands>

```bash
bandit -r src
pip-audit
detect-secrets scan --all-files > .secrets.baseline
semgrep scan --config auto
```

</security_commands>

<trusted_publishing_permissions>

```yaml
permissions:
  contents: read
  id-token: write
```

</trusted_publishing_permissions> </tooling_templates>
