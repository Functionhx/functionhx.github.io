#!/usr/bin/env python3
"""Validate the intentionally empty bilingual section tree."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"

PAGES = {
    "_index.md": ("home", "首页", "Home"),
    "projects/_index.md": ("projects", "项目", "Projects"),
    "research/_index.md": ("research", "研究", "Research"),
    "open-source/_index.md": ("open-source", "开源", "Open Source"),
    "notes/_index.md": ("notes", "笔记", "Notes"),
    "about/_index.md": ("about", "关于", "About"),
}


def read_front_matter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing opening front-matter delimiter")

    try:
        end = lines.index("---", 1)
    except ValueError as error:
        raise ValueError("missing closing front-matter delimiter") from error

    data: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"invalid front-matter line: {line}")
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip("\"'")

    return data, "\n".join(lines[end + 1 :]).strip()


def main() -> int:
    errors: list[str] = []
    expected = {
        CONTENT / language / relative
        for language in ("zh", "en")
        for relative in PAGES
    }
    actual = set(CONTENT.rglob("*.md"))

    for path in sorted(expected - actual):
        errors.append(f"missing page: {path.relative_to(ROOT)}")
    for path in sorted(actual - expected):
        errors.append(f"unexpected page: {path.relative_to(ROOT)}")

    for relative, (translation_key, zh_title, en_title) in PAGES.items():
        for language, title in (("zh", zh_title), ("en", en_title)):
            path = CONTENT / language / relative
            if not path.exists():
                continue
            try:
                data, body = read_front_matter(path)
            except ValueError as error:
                errors.append(f"{path.relative_to(ROOT)}: {error}")
                continue

            expected_data = {
                "title": title,
                "translationKey": translation_key,
            }
            if data != expected_data:
                errors.append(
                    f"{path.relative_to(ROOT)}: front matter must be exactly "
                    f"{expected_data}"
                )
            if body:
                errors.append(f"{path.relative_to(ROOT)}: body must be empty")

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1

    print("Validated 12 empty bilingual section pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
