#!/usr/bin/env python3
"""Render a bilingual Markdown index of public project and research pages."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import repository_root, validated_showcase, write_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = repository_root()
    data = validated_showcase(root)
    base = "https://functionhx.github.io"
    lines = ["# Portfolio Index", "", "Generated from `data/showcase/`; review before external reuse.", "", "## Projects", ""]
    for record in data["projects"]["records"]:
        lines.append(f"- [{record['title']['en']}]({base}{record['page']}) — `{record['status']}`")
    lines.extend(["", "## Research", ""])
    for record in data["research"]["records"]:
        lines.append(f"- [{record['title']['en']}]({base}{record['page']}) — `{record['status']}`")
    output = args.output or root / "generated" / "portfolio-index.md"
    write_text(output, "\n".join(lines))
    print(f"wrote {output.relative_to(root) if output.is_relative_to(root) else output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
