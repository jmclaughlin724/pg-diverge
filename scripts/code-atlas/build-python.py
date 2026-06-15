#!/usr/bin/env python3
import ast
import json
import sys
from pathlib import PurePosixPath
from pathlib import Path


def main() -> None:
    payload = json.load(sys.stdin)
    # Active-file selection is owned by build.mjs; this helper only enriches
    # the Python files that the JS atlas builder passes through.
    files = sorted(payload.get("files", []))
    file_set = set(payload.get("allFiles", files))
    nodes = []
    edges = []
    diagnostics = []
    for file in files:
        try:
            text = Path(file).read_text(encoding="utf8")
            tree = ast.parse(text, filename=file)
        except Exception as exc:  # noqa: BLE001 - diagnostics are data for the JS caller.
            diagnostics.append({"file": file, "message": str(exc)})
            continue
        attach_parents(tree)
        collect_module(nodes, edges, file, tree)
        collect_imports(nodes, edges, file, tree, file_set)
        collect_fastapi(nodes, edges, file, tree)
        collect_typer(nodes, edges, file, tree)
        collect_file_references(edges, file, tree, file_set)
    print(json.dumps({"nodes": nodes, "edges": edges, "diagnostics": diagnostics}))


def attach_parents(tree: ast.AST) -> None:
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            child.parent = parent


def collect_module(nodes: list[dict], edges: list[dict], file: str, tree: ast.Module) -> None:
    module_id = f"python_module:{module_name(file)}"
    nodes.append({"id": module_id, "kind": "python_module", "name": module_name(file), "path": file})
    edges.append({"from": file_id(file), "to": module_id, "type": "declares_python_module", "evidence": file})
    for statement in tree.body:
        if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbol_id = f"python_symbol:{file}#{statement.name}"
            nodes.append({"id": symbol_id, "kind": "python_symbol", "name": statement.name, "path": file})
            edges.append({"from": file_id(file), "to": symbol_id, "type": "declares_symbol", "evidence": file})


def collect_imports(
    nodes: list[dict],
    edges: list[dict],
    file: str,
    tree: ast.Module,
    file_set: set[str],
) -> None:
    for node in ast.walk(tree):
        imported_names: list[str] = []
        if isinstance(node, ast.Import):
            imported_names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_names = [node.module]
        for name in imported_names:
            target = resolve_python_import(file, name, file_set)
            if not target:
                continue
            edges.append({"from": file_id(file), "to": file_id(target), "type": "imports_file", "evidence": name})


def collect_fastapi(nodes: list[dict], edges: list[dict], file: str, tree: ast.Module) -> None:
    if "/routers/" in f"/{file}":
        router_id = f"api_router:{module_name(file)}"
        nodes.append({"id": router_id, "kind": "api_router", "name": module_name(file), "path": file})
        edges.append({"from": file_id(file), "to": router_id, "type": "declares_api_router", "evidence": file})
    else:
        router_id = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                method = fastapi_method(decorator)
                if method and router_id:
                    endpoint_id = f"api_endpoint:{module_name(file)}.{node.name}"
                    nodes.append(
                        {
                            "id": endpoint_id,
                            "kind": "api_endpoint",
                            "name": node.name,
                            "method": method,
                            "path": file,
                        }
                    )
                    edges.append(
                        {
                            "from": router_id,
                            "to": endpoint_id,
                            "type": "declares_api_endpoint",
                            "evidence": method,
                        }
                    )
        if isinstance(node, ast.Call) and call_name(node.func).endswith("include_router"):
            for arg in node.args:
                if call_name(arg).endswith(".router"):
                    edges.append(
                        {
                            "from": file_id(file),
                            "to": f"api_router:{call_name(arg).removesuffix('.router')}",
                            "type": "registers_api_router",
                            "evidence": "include_router",
                        }
                    )


def collect_typer(nodes: list[dict], edges: list[dict], file: str, tree: ast.Module) -> None:
    if "/commands/" in f"/{file}":
        group_id = f"worker_command_group:{module_name(file)}"
        nodes.append({"id": group_id, "kind": "worker_command_group", "name": module_name(file), "path": file})
        edges.append(
            {"from": file_id(file), "to": group_id, "type": "declares_worker_command_group", "evidence": file}
        )
    else:
        group_id = None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                if call_name(decorator).endswith(".command") and group_id:
                    command_id = f"worker_job:{module_name(file)}.{node.name}"
                    nodes.append({"id": command_id, "kind": "worker_job", "name": node.name, "path": file})
                    edges.append(
                        {
                            "from": group_id,
                            "to": command_id,
                            "type": "declares_worker_job",
                            "evidence": "typer.command",
                        }
                    )
        if isinstance(node, ast.Call) and call_name(node.func).endswith("add_typer"):
            name = keyword_string(node, "name")
            target = call_name(node.args[0]) if node.args else ""
            if target:
                edges.append(
                    {
                        "from": file_id(file),
                        "to": f"worker_command_group:{target}",
                        "type": "registers_worker_group",
                        "evidence": name or "add_typer",
                    }
                )


def collect_file_references(edges: list[dict], file: str, tree: ast.Module, file_set: set[str]) -> None:
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in file_set:
            edges.append(
                {
                    "from": file_id(file),
                    "to": file_id(node.value),
                    "type": "references_file",
                    "evidence": "string literal",
                }
            )


def fastapi_method(node: ast.AST) -> str | None:
    name = call_name(node)
    methods = {"get", "post", "put", "patch", "delete", "options", "head"}
    tail = name.rsplit(".", 1)[-1]
    return tail.upper() if tail in methods else None


def call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Call):
        return call_name(node.func)
    if isinstance(node, ast.Attribute):
        parent = call_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    if isinstance(node, ast.Name):
        return node.id
    return ""


def keyword_string(node: ast.Call, key: str) -> str | None:
    for keyword in node.keywords:
        if keyword.arg == key and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
            return keyword.value.value
    return None


def resolve_python_import(file: str, name: str, file_set: set[str]) -> str | None:
    base = PurePosixPath(*name.split("."))
    candidates = [f"{base}.py", f"{base}/__init__.py"]
    parent = PurePosixPath(file).parent
    candidates.extend([str(parent / candidate) for candidate in candidates])
    for candidate in candidates:
        normalized = str(PurePosixPath(candidate))
        if normalized in file_set:
            return normalized
    return None


def module_name(file: str) -> str:
    path = PurePosixPath(file)
    if path.name == "__init__.py":
        return ".".join(path.parent.parts)
    return ".".join((*path.parent.parts, path.stem))


def file_id(file: str) -> str:
    return f"file:{file}"


if __name__ == "__main__":
    main()
