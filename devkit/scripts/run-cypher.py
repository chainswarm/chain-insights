#!/usr/bin/env python3
import argparse
import json
import sys
from typing import Any

from neo4j import GraphDatabase


def split_statements(text: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escape = False
    for char in text:
        current.append(char)
        if quote is not None:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"'}:
            quote = char
            continue
        if char == ";":
            statement = "".join(current).strip().rstrip(";").strip()
            if statement:
                statements.append(statement)
            current = []
    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def format_value(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value)
    if value is None:
        return "null"
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return str(value)


def run_statement(session: Any, statement: str) -> None:
    result = session.run(statement)
    for record in result:
        print("| " + " | ".join(format_value(value) for value in record.values()) + " |")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", default="7687")
    parser.add_argument("--execute")
    args = parser.parse_args()

    text = args.execute if args.execute is not None else sys.stdin.read()
    statements = split_statements(text)
    if not statements:
        return

    uri = f"bolt://{args.host}:{args.port}"
    driver = GraphDatabase.driver(uri, auth=None)
    try:
        with driver.session() as session:
            for statement in statements:
                run_statement(session, statement)
    finally:
        driver.close()


if __name__ == "__main__":
    main()
