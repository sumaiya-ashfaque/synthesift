#!/usr/bin/env python3
"""Ensure the implemented route surface matches the reviewed M0 contract."""

import sys
from pathlib import Path

import yaml


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}


def operations(spec: dict) -> set[tuple[str, str]]:
    return {
        (path.rstrip("/"), method)
        for path, route in spec["paths"].items()
        for method in route
        if method in HTTP_METHODS
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: check_contract.py <reviewed.yaml> <generated.yaml>", file=sys.stderr)
        return 2

    reviewed, generated = [yaml.safe_load(Path(path).read_text(encoding="utf-8")) for path in sys.argv[1:]]
    expected = operations(reviewed)
    actual = operations(generated)
    if expected != actual:
        print(f"API surface drift. Missing: {sorted(expected - actual)}; unexpected: {sorted(actual - expected)}")
        return 1
    print(f"Contract route surface matches ({len(actual)} operations).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
