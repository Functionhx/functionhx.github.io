#!/usr/bin/env python3
"""Validate bilingual content pairs and their core front matter."""

from pathlib import Path
import re
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
LANGUAGES = ("zh", "en")
REQUIRED_SECTIONS = {
    "_index.md": "home",
    "projects/_index.md": "projects",
    "research/_index.md": "research",
    "open-source/_index.md": "open-source",
    "tools/_index.md": "tools",
    "writing/_index.md": "writing",
    "notes/_index.md": "notes",
    "logs/_index.md": "logs",
    "about/_index.md": "about",
}
MARKDOWN_LINK = re.compile(r"\[[^\]]+\]\((?!https?://|mailto:|#)([^)\s]+)")


def read_page(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing opening front-matter delimiter")

    try:
        end = lines.index("---", 1)
    except ValueError as error:
        raise ValueError("missing closing front-matter delimiter") from error

    front_matter = yaml.safe_load("\n".join(lines[1:end])) or {}
    if not isinstance(front_matter, dict):
        raise ValueError("front matter must be a mapping")
    return front_matter, "\n".join(lines[end + 1 :])


def main() -> int:
    errors: list[str] = []
    paths = {
        language: {
            path.relative_to(CONTENT / language)
            for path in (CONTENT / language).rglob("*.md")
        }
        for language in LANGUAGES
    }

    for language in LANGUAGES:
        for relative, translation_key in REQUIRED_SECTIONS.items():
            path = CONTENT / language / relative
            if not path.exists():
                errors.append(f"missing page: {path.relative_to(ROOT)}")
                continue
            try:
                data, _ = read_page(path)
            except ValueError as error:
                errors.append(f"{path.relative_to(ROOT)}: {error}")
                continue
            if data.get("translationKey") != translation_key:
                errors.append(
                    f"{path.relative_to(ROOT)}: expected translationKey "
                    f"{translation_key!r}"
                )
            if not data.get("title"):
                errors.append(f"{path.relative_to(ROOT)}: title is required")

    if paths["zh"] != paths["en"]:
        for relative in sorted(paths["zh"] - paths["en"]):
            errors.append(f"missing English translation: content/en/{relative}")
        for relative in sorted(paths["en"] - paths["zh"]):
            errors.append(f"missing Chinese source page: content/zh/{relative}")

    for relative in sorted(paths["zh"] & paths["en"]):
        records: dict[str, tuple[dict, str]] = {}
        for language in LANGUAGES:
            path = CONTENT / language / relative
            try:
                records[language] = read_page(path)
            except ValueError as error:
                errors.append(f"{path.relative_to(ROOT)}: {error}")
        if len(records) != len(LANGUAGES):
            continue

        zh_key = records["zh"][0].get("translationKey")
        en_key = records["en"][0].get("translationKey")
        if not zh_key or zh_key != en_key:
            errors.append(
                f"{relative}: translationKey mismatch ({zh_key!r} != {en_key!r})"
            )

        for language, (_, body) in records.items():
            page = CONTENT / language / relative
            for target in MARKDOWN_LINK.findall(body):
                clean_target = target.split("#", 1)[0].split("?", 1)[0]
                if not clean_target:
                    continue
                resolved = (page.parent / clean_target).resolve()
                if not resolved.exists():
                    errors.append(
                        f"{page.relative_to(ROOT)}: broken local link {target!r}"
                    )

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1

    print(
        f"Validated {len(paths['zh'])} bilingual page pairs, "
        "required sections, and local Markdown links."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
