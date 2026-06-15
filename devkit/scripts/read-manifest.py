#!/usr/bin/env python3
import json
import sys
from pathlib import Path


MANIFEST = Path(__file__).resolve().parents[1] / "data/manifest.json"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: read-manifest.py <dot.path>")
    value: object = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for part in sys.argv[1].split("."):
        if not isinstance(value, dict) or part not in value:
            raise SystemExit(f"manifest key not found: {sys.argv[1]}")
        value = value[part]
    if isinstance(value, (dict, list)):
        print(json.dumps(value, sort_keys=True))
    else:
        print(value)


if __name__ == "__main__":
    main()
