#!/usr/bin/env bash
# no-server-test: refuse a test that asks for a server. Every ChainSwarm test
# is T1 (AP1000 change validator-agents-replace-integration-tests, spec
# testing-pyramid, "Every test is T1"). A repository's ci/lint.sh runs it:
#
#   bash .github/scripts/no-server-test.sh .        a repository's own copy, from its root
#   bash scripts/testing/no-server-test.sh <repo-root>    from AP1000
#
# One file, no install: bash and python3 only, so a repository can carry a
# byte-for-byte copy as .github/scripts/no-server-test.sh. AP1000 is its one home; the copy
# is checked against it (AP1000 scripts/testing/README.md, "no-server-test").
#
# What it refuses, one line per finding, "<file>:<line>: <rule>: <detail>":
#
#   GO_TAG     a Go test file whose build constraint names `integration`
#              (`//go:build integration`, `// +build integration`).
#   PY_MARK    a Python test that asks for the `integration` marker
#              (`pytest.mark.integration`, `-m integration`).
#   SERVER_ENV a test file of any language that reads a server's setting
#              from the environment: a STARROCKS_*, DOZERDB_* or NEO4J_*
#              name, or a node URL (*RPC_URL*, *NODE_URL*). Such a test runs
#              only when a server is there, so it skips everywhere else.
#              Setting the variable for the code under test (t.Setenv,
#              monkeypatch.setenv, env={...}) is not a read and passes.
#              A Go file whose build constraint names a tag ending in
#              `generate` (`//go:build golden_generate`) is a generator run
#              by hand, never compiled into a test run: it is not read.
#              The rule is ml-pipeline ci/lint.sh's, widened from STARROCKS_
#              to the graph store and the node.
#   PY_TIER    a pytest test with no tier marker, or with two: a module
#              function `test*`, or a method `test*` of a class `Test*`. The
#              tiers are `unit` and `acceptance`, plus `cuda`, ml-pipeline's
#              GPU tier; ml-pipeline tests/conftest.py refuses the same at
#              collection. A marker counts on the function, on its class, or
#              in the module's `pytestmark`. A unittest.TestCase class not
#              named `Test*` is run by unittest, which has no markers: it is
#              not read.
#
# Skipped folders: .git, node_modules, .venv, venv, vendor, target, dist,
# build, testdata, fixtures, and every folder whose name starts with `.ci`.
#
# Exit codes: 0 clean, 1 a finding, 2 bad arguments.
# Prints one last line: "no-server-test: <n> findings in <m> test files".
set -euo pipefail

usage() { echo "usage: no-server-test.sh <repo-root>" >&2; exit 2; }
root=""
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage ;;
    -*) echo "no-server-test: unknown option $arg" >&2; usage ;;
    *) [ -z "$root" ] || usage; root="$arg" ;;
  esac
done
[ -n "$root" ] || usage
[ -d "$root" ] || { echo "no-server-test: $root is not a folder" >&2; exit 2; }

exec python3 - "$root" <<'PY'
import ast
import os
import re
import sys

root = sys.argv[1]
SKIP = {".git", "node_modules", ".venv", "venv", "vendor", "target", "dist", "build", "testdata", "fixtures", "__pycache__"}
TIER_MARKERS = {"unit", "acceptance", "cuda"}

SERVER = r"(?:STARROCKS_\w*|DOZERDB_\w*|NEO4J_\w*|\w*(?:RPC|NODE)_URL\w*)"
# Reads only: a lookup of the variable's value, never a set.
READS = [
    re.compile(r"""os\.environ\.get\(\s*["']""" + SERVER),
    re.compile(r"""os\.environ\[\s*["']""" + SERVER + r"""["']\s*\](?!\s*=[^=])"""),
    re.compile(r"""os\.getenv\(\s*["']""" + SERVER),
    re.compile(r"""os\.(?:Getenv|LookupEnv)\(\s*"(?:""" + SERVER + r')"'),
    re.compile(r"""(?<!delete )process\.env(?:\.|\[\s*["'])""" + SERVER + r"""\b["']?\]?(?!\s*=[^=])"""),
    re.compile(r"""(?:std::)?env::var(?:_os)?\(\s*"(?:""" + SERVER + r')"'),
]
GO_TAG = re.compile(r"^//\s*(?:go:build|\+build)\s.*\bintegration\b")
GO_GENERATOR = re.compile(r"^//\s*(?:go:build|\+build)\s.*\b\w*generate\b")
PY_MARK = re.compile(r"mark\.integration\b|-m\s+[\"']?integration\b")


def test_file(rel):
    name = os.path.basename(rel)
    if name.endswith("_test.go"):
        return "go"
    if name.endswith(".py") and (name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"):
        return "py"
    if re.search(r"\.(?:test|spec)\.[cm]?[jt]sx?$", name):
        return "js"
    if name.endswith(".rs") and ("/tests/" in "/" + rel or name.endswith("_test.rs") or name == "tests.rs"):
        return "rs"
    return None


def marker_names(decorators):
    out = set()
    for d in decorators:
        node = d.func if isinstance(d, ast.Call) else d
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Attribute) and node.value.attr == "mark":
            out.add(node.attr)
    return out


def module_marks(tree):
    out = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "pytestmark" for t in node.targets):
            values = node.value.elts if isinstance(node.value, (ast.List, ast.Tuple)) else [node.value]
            out |= marker_names(values)
    return out


def py_tiers(rel, text, findings):
    try:
        tree = ast.parse(text)
    except SyntaxError as error:
        findings.append((rel, error.lineno or 1, "PY_TIER", "the file does not parse"))
        return
    base = module_marks(tree)

    def check(fn, inherited):
        tiers_found = sorted((marker_names(fn.decorator_list) | inherited) & TIER_MARKERS)
        if len(tiers_found) != 1:
            what = ", ".join(tiers_found) if tiers_found else "no tier marker"
            findings.append((rel, fn.lineno, "PY_TIER", f"{fn.name} has {what}; one of unit, acceptance, cuda"))

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test"):
            check(node, base)
        elif isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
            inherited = base | marker_names(node.decorator_list)
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name.startswith("test"):
                    check(item, inherited)


findings = []
files = 0
for directory, folders, names in os.walk(root):
    folders[:] = sorted(f for f in folders if f not in SKIP and not f.startswith(".ci"))
    for name in sorted(names):
        path = os.path.join(directory, name)
        rel = os.path.relpath(path, root)
        kind = test_file(rel)
        if kind is None:
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError:
            continue
        files += 1
        lines = text.splitlines()
        generator = False
        if kind == "go":
            for number, line in enumerate(lines, 1):
                if line.startswith("package "):
                    break
                if GO_TAG.match(line):
                    findings.append((rel, number, "GO_TAG", line.strip()))
                elif GO_GENERATOR.match(line):
                    generator = True
        if generator:
            continue
        if kind == "py":
            for number, line in enumerate(lines, 1):
                if PY_MARK.search(line):
                    findings.append((rel, number, "PY_MARK", line.strip()))
            if name != "conftest.py":
                py_tiers(rel, text, findings)
        for number, line in enumerate(lines, 1):
            for pattern in READS:
                match = pattern.search(line)
                if match:
                    findings.append((rel, number, "SERVER_ENV", match.group(0)))
                    break

for rel, number, rule, detail in findings:
    print(f"{rel}:{number}: {rule}: {detail}")
print(f"no-server-test: {len(findings)} findings in {files} test files")
if findings:
    print("no-server-test: every test is T1; written rows are judged on the staging lane by a validator"
          " (AP1000 AGENTS.md \"Tests\")", file=sys.stderr)
sys.exit(1 if findings else 0)
PY
