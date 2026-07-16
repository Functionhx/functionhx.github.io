#!/usr/bin/env python3
"""Export the validated fact source for Hugo and the built public directory."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import public_showcase, repository_root, validated_showcase, write_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--static-output", type=Path, help="Override the tracked Hugo static output")
    parser.add_argument("--public-output", type=Path, help="Override the ignored build output")
    parser.add_argument("--skip-public", action="store_true", help="Do not write public/showcase.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = repository_root()
    payload = public_showcase(validated_showcase(root))
    static_output = args.static_output or root / "static" / "showcase.json"
    write_json(static_output, payload)
    print(f"wrote {static_output.relative_to(root) if static_output.is_relative_to(root) else static_output}")
    if not args.skip_public:
        public_output = args.public_output or root / "public" / "showcase.json"
        write_json(public_output, payload)
        print(f"wrote {public_output.relative_to(root) if public_output.is_relative_to(root) else public_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
