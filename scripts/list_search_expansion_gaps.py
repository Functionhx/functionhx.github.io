#!/usr/bin/env python3
"""List chunks in the built search index that have no entry in
_data/search_expansions.yml, and entries in that file that no longer match any
current chunk. Run after `bundle exec jekyll build`.

This never calls a model itself: it just finds the gaps so whoever is writing
or editing content (usually via Claude Code) can read the listed text and add
a few alternate phrasings by hand. See _data/search_expansions.yml for the
format and why missing entries are not an error.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "_site" / "assets" / "search" / "index-zh.json"
EXPANSIONS_PATH = ROOT / "_data" / "search_expansions.yml"


def main() -> int:
    if not INDEX_PATH.exists():
        print(f"{INDEX_PATH} does not exist; run `bundle exec jekyll build` first.", file=sys.stderr)
        return 1

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    expansions = yaml.safe_load(EXPANSIONS_PATH.read_text(encoding="utf-8")) or {}
    if not isinstance(expansions, dict):
        print(f"{EXPANSIONS_PATH} must contain a mapping", file=sys.stderr)
        return 1

    chunks = index.get("chunks", [])
    current_hashes = {chunk["content_hash"] for chunk in chunks}

    missing = [chunk for chunk in chunks if chunk["content_hash"] not in expansions]
    stale = sorted(set(expansions) - current_hashes)

    if missing:
        print(f"{len(missing)} chunk(s) with no search expansion entry:\n")
        for chunk in missing:
            heading = f" > {chunk['heading']}" if chunk.get("heading") else ""
            print(f"- {chunk['content_hash']}")
            print(f"  {chunk['title']}{heading}")
            print(f"  {chunk['text'][:160]}")
            print()
    else:
        print("Every current chunk has a search expansion entry.")

    if stale:
        print(f"\n{len(stale)} stale entry(ies) no longer match any chunk (safe to delete):")
        for content_hash in stale:
            print(f"- {content_hash}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
