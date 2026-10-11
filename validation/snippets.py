"""Checks the code in "what does this print?" questions by running it.

A question with "verify": "stdout" must print exactly one line, and that line must be the keyed
option's text (one pair of surrounding backticks is ignored). No other option may match it.

Safety: the snippets are written in this repository and reviewed like any other code. Before
running one, a lint pass rejects imports outside a small standard-library allowlist and names that
reach for files, the interpreter, or other processes. It then runs in a separate Python process
with no site packages, an empty temporary folder as the working directory, a minimal environment,
and a timeout. This is a lint, not a sandbox: never point it at code you have not read.
"""
from __future__ import annotations

import ast
import os
import subprocess
import sys
import tempfile

TIMEOUT_SECONDS = 5
HASH_SEEDS = ("0", "1")  # run twice: output that changes with the hash seed (set order) is not deterministic

ALLOWED_IMPORTS = {
    "__future__", "argparse", "collections", "csv", "dataclasses", "datetime", "decimal", "fractions",
    "functools", "io", "itertools", "json", "math", "operator", "pathlib", "re", "statistics", "string",
    "textwrap", "typing",
}
BANNED_NAMES = {
    "__import__", "breakpoint", "compile", "delattr", "eval", "exec", "exit", "getattr", "globals",
    "input", "locals", "open", "quit", "setattr", "vars",
}
BANNED_ATTRIBUTES = {
    "__bases__", "__builtins__", "__class__", "__code__", "__dict__", "__getattribute__", "__globals__",
    "__loader__", "__mro__", "__spec__", "__subclasses__",
    # Path methods that touch the file system; PurePosixPath and friends are fine.
    "chmod", "mkdir", "open", "read_bytes", "read_text", "rename", "replace", "rmdir", "symlink_to",
    "touch", "unlink", "write_bytes", "write_text",
}


def lint(code: str) -> list[str]:
    """Problems that stop a snippet from being run. An empty list means it may run."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return [f"code does not parse: {exc.msg} (line {exc.lineno})"]
    problems = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [a.name.split(".")[0] for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [(node.module or "").split(".")[0]]
        else:
            names = []
        for name in names:
            if name not in ALLOWED_IMPORTS:
                problems.append(f"import of '{name}' is not allowed in question code")
        if isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            problems.append(f"'{node.id}' is not allowed in question code")
        if isinstance(node, ast.Attribute) and node.attr in BANNED_ATTRIBUTES:
            problems.append(f"'.{node.attr}' is not allowed in question code")
    return problems


def run(code: str, hash_seed: str = "0", timeout: float = TIMEOUT_SECONDS) -> subprocess.CompletedProcess:
    """Runs code in a fresh interpreter: no site packages, no bytecode files, an empty working folder."""
    env = {"PYTHONHASHSEED": hash_seed, "PYTHONIOENCODING": "utf-8"}
    if os.name == "nt" and "SYSTEMROOT" in os.environ:
        env["SYSTEMROOT"] = os.environ["SYSTEMROOT"]  # Windows needs this for Python to start
    with tempfile.TemporaryDirectory() as cwd:
        return subprocess.run(
            [sys.executable, "-s", "-S", "-B", "-"],
            input=code,
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=cwd,
            env=env,
            timeout=timeout,
        )


def unwrap(text: str) -> str:
    """An option shown as inline code, `like this`, is compared without its backticks."""
    text = str(text).strip()
    if len(text) >= 2 and text.startswith("`") and text.endswith("`"):
        return text[1:-1]
    return text


def check_question(q: dict) -> list[str]:
    """Failure messages for one question (empty when the code is fine)."""
    code = q.get("code")
    if not code:
        return ["verify is set but the question has no code"] if q.get("verify") else []
    problems = lint(code)
    if problems or q.get("verify") != "stdout":
        return problems
    outputs = set()
    for seed in HASH_SEEDS:
        try:
            proc = run(code, seed)
        except subprocess.TimeoutExpired:
            return [f"code did not finish within {TIMEOUT_SECONDS} seconds"]
        if proc.returncode != 0:
            last = (proc.stderr.strip().splitlines() or ["no error output"])[-1]
            return [f"code exited with status {proc.returncode}: {last}"]
        outputs.add(proc.stdout.rstrip("\n"))
    if len(outputs) > 1:
        return ["code prints different output from run to run (for example, set order); make it deterministic"]
    out = outputs.pop()
    if "\n" in out:
        return ["code must print exactly one line"]
    options = q.get("options") or {}
    key = q.get("answer")
    failures = []
    if unwrap(options.get(key, "")) != out:
        failures.append(f"code prints {out!r} but the keyed option {key} is {unwrap(options.get(key, ''))!r}")
    for letter, text in options.items():
        if letter != key and unwrap(text) == out:
            failures.append(f"option {letter} also matches the printed output {out!r}")
    return failures
