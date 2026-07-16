#!/usr/bin/env python3
"""Validate data/showcase without mutating repository files."""

from __future__ import annotations

import sys

from common import ValidationError, validated_showcase


def main() -> int:
    try:
        data = validated_showcase()
    except (OSError, ValidationError) as error:
        print(f"showcase validation failed: {error}", file=sys.stderr)
        return 1
    records = len(data["projects"]["records"]) + len(data["research"]["records"])
    enabled_links = sum(1 for item in data["links"]["items"] if item["enabled"])
    print(f"showcase validation passed: {records} project/research records, {enabled_links} public links")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
