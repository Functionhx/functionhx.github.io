#!/usr/bin/env python3
"""Render a reviewable GitHub profile section from public showcase facts."""

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
    profile = data["profile"]
    open_source = data["open_source"]
    achievement = data["achievements"]["items"][0]
    website = next(item["url"] for item in data["links"]["items"] if item["id"] == "website")
    focus = " · ".join(item["title"]["en"] for item in profile["focus"])
    ecosystems = ", ".join(item["name"] for item in open_source["ecosystems"])
    count = open_source["metrics"]["merged_pull_requests"]["value"]
    lines = [
        "<!-- showcase:start -->",
        "## Yuchen Fan",
        "",
        f"**{profile['headline']['en']}**",
        "",
        profile["tagline"]["en"],
        "",
        f"- Focus: {focus}",
        f"- Open source: {count} merged upstream pull requests across {ecosystems}",
        f"- Achievement: {achievement['title']['en']} — {achievement['detail']['en']}",
        f"- Portfolio: [{website}]({website})",
        "",
        "<!-- showcase:end -->",
    ]
    output = args.output or root / "generated" / "github-profile-section.md"
    write_text(output, "\n".join(lines))
    print(f"wrote {output.relative_to(root) if output.is_relative_to(root) else output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
