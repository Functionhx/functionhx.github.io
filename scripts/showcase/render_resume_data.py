#!/usr/bin/env python3
"""Render a portable, public résumé-data JSON document."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import repository_root, validated_showcase, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = repository_root()
    data = validated_showcase(root)
    payload = {
        "schema_version": 1,
        "profile": data["profile"],
        "projects": data["projects"]["records"],
        "research": data["research"]["records"],
        "achievements": data["achievements"]["items"],
        "open_source": data["open_source"],
        "links": [item for item in data["links"]["items"] if item["enabled"]],
    }
    output = args.output or root / "generated" / "resume-data.json"
    write_json(output, payload)
    print(f"wrote {output.relative_to(root) if output.is_relative_to(root) else output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
