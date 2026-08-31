#!/usr/bin/env python3
"""Lint a repo README against the Chain Insights docs golden standard (Chain Insights documentation standard).

The `Chain Insights documentation standard` skill defines the 11 required README sections; this is
the enforceable half. The per-repo `docs` action runs it (warn-only during the
docs-layer rework rollout, a hard gate after); an operator runs it ad hoc. It
checks that the required sections are present (by heading-keyword match, tolerant
of repo-specific naming) and reports what is missing. Section *content* stays an
agent task — this only enforces shape.

Usage:
  check-readme-standard.py [--repo-root DIR] [--readme PATH] [--json] [--warn-only]

Exit non-zero when a REQUIRED section is missing (unless --warn-only).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent

# (label, [keyword alternatives matched case-insensitively in a heading], required)
SECTIONS = [
    ("purpose / ownership", ["purpose", "overview", "what is", "ownership", "about"], True),
    ("what it does / boundaries", ["what it does", "boundaries", "scope"], True),
    ("dependencies", ["dependencies", "upstream", "downstream"], True),
    ("architecture (tab or section)", ["architecture", "design", "components"], True),
    ("prerequisites / environment setup", ["prerequisite", "requirements", "environment", "\\.env", "setup"], True),
    ("run (local + dev compose)", ["run", "usage", "quickstart", "getting started", "compose", "develop"], True),
    ("configure", ["config"], True),
    ("test commands", ["test"], True),
    ("debug / health / logs", ["debug", "logs", "troubleshoot", "logging", "health", "smoke"], True),
    ("pre-staging / release", ["pre-staging", "prestaging", "deploy", "release", "rollout", "helm"], True),
    (
        "documentation links (tabs or docs/)",
        ["links", "see also", "references", "documentation", "docs/", "spec.md", "architecture.md"],
        True,
    ),
]


def _kw_pattern(kw: str) -> str:
    # Anchor at a word boundary only for keywords starting with a word char:
    # "run" must not match "Trunk-based", but "config" must still match
    # "Configure". Non-word starters (e.g. "\.env") are left unanchored.
    return r"\b" + kw if kw[0].isalnum() else kw


def heading_lines(text: str) -> list[str]:
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            out.append(s.lstrip("#").strip().lower())
    return out


def evaluate(readme_text: str) -> dict:
    headings = heading_lines(readme_text)
    # body fallback applies to the "links" case only (docs/ path reference)
    body = readme_text.lower()
    missing_required, missing_optional, present = [], [], []
    for label, kws, required in SECTIONS:
        found = any(re.search(_kw_pattern(kw), h) for h in headings for kw in kws)
        if not found and "links" in label:
            # Body fallback: docs/ path or root tab files count as linking out.
            found = (
                re.search(r"docs/", body) is not None
                or re.search(r"\b(spec|architecture)\.md\b", body) is not None
            )
        if not found and "architecture" in label:
            found = re.search(r"\barchitecture\.md\b", body) is not None
        (present if found else (missing_required if required else missing_optional)).append(label)
    return {
        "present": present,
        "missing_required": missing_required,
        "missing_optional": missing_optional,
        "ok": not missing_required,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--repo-root", default=str(REPO_ROOT))
    p.add_argument("--readme", default=None, help="path to README (default <repo-root>/README.md)")
    p.add_argument("--json", action="store_true")
    p.add_argument("--warn-only", action="store_true", help="never exit non-zero")
    args = p.parse_args(argv)

    readme = Path(args.readme) if args.readme else Path(args.repo_root) / "README.md"
    if not readme.is_file():
        msg = f"README not found: {readme}"
        print(json.dumps({"ok": False, "error": msg}) if args.json else f"ERROR: {msg}", file=sys.stderr)
        return 0 if args.warn_only else 2

    result = evaluate(readme.read_text(encoding="utf-8", errors="ignore"))
    result["readme"] = str(readme)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"README golden-standard check: {readme}")
        print(f"  present ({len(result['present'])}): {', '.join(result['present']) or '-'}")
        if result["missing_required"]:
            print(f"  MISSING REQUIRED: {', '.join(result['missing_required'])}")
        if result["missing_optional"]:
            print(f"  missing optional: {', '.join(result['missing_optional'])}")
        print("  RESULT:", "ok" if result["ok"] else "FAIL (required sections missing)")
    if not result["ok"] and not args.warn_only:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
