#!/usr/bin/env python3
"""Validate bilingual source content and project-specific integration contracts."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
CONTENT_DIRECTORIES = (
    "_pages",
    "_projects",
    "_news",
    "_posts",
    "_teachings",
    "_books",
)
LANGUAGES = {"zh", "en"}
REQUIRED_ROUTES = {
    "home": {"/", "/en/"},
    "blog": {"/blog/", "/en/blog/"},
    "publications": {"/publications/", "/en/publications/"},
    "projects": {"/projects/", "/en/projects/"},
    "repositories": {"/repositories/", "/en/repositories/"},
    "cv": {"/cv/", "/en/cv/"},
    "teaching": {"/teaching/", "/en/teaching/"},
    "people": {"/people/", "/en/people/"},
    "more": {"/more/", "/en/more/"},
    "books": {"/books/", "/en/books/"},
    "tools": {"/tools/", "/en/tools/"},
    "notes": {"/notes/", "/en/notes/"},
    "logs": {"/logs/", "/en/logs/"},
    "news": {"/news/", "/en/news/"},
    "not-found": {"/404.html", "/en/404/"},
}


def front_matter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", text, re.DOTALL)
    if not match:
        raise ValueError("missing YAML front matter")
    data = yaml.safe_load(match.group(1))
    if not isinstance(data, dict):
        raise ValueError("front matter must be a mapping")
    return data


def main() -> int:
    errors: list[str] = []
    records: list[tuple[str, Path, dict]] = []

    for directory_name in CONTENT_DIRECTORIES:
        directory = ROOT / directory_name
        if not directory.exists():
            continue
        for path in sorted(directory.rglob("*")):
            if path.suffix not in {".md", ".markdown", ".html"}:
                continue
            try:
                data = front_matter(path)
            except (OSError, ValueError, yaml.YAMLError) as error:
                errors.append(f"{path.relative_to(ROOT)}: {error}")
                continue
            records.append((directory_name, path, data))

    groups: dict[tuple[str, str], list[tuple[Path, dict]]] = defaultdict(list)
    for collection, path, data in records:
        relative = path.relative_to(ROOT)
        language = data.get("lang")
        key = data.get("translation_key")
        if language not in LANGUAGES:
            errors.append(f"{relative}: lang must be one of {sorted(LANGUAGES)}")
        if not isinstance(key, str) or not key.strip():
            errors.append(f"{relative}: translation_key is required")
            continue
        groups[(collection, key)].append((path, data))

        if collection == "_projects":
            for field in ("description", "kind", "status", "source"):
                if not data.get(field):
                    errors.append(f"{relative}: project field {field!r} is required")

        if data.get("placeholder"):
            source = str(data.get("source", "")).lower()
            if "al-folio" not in source:
                errors.append(
                    f"{relative}: placeholder records must identify al-folio as their source"
                )

    for (collection, key), items in sorted(groups.items()):
        languages = [data.get("lang") for _, data in items]
        if set(languages) != LANGUAGES or len(languages) != len(LANGUAGES):
            locations = ", ".join(str(path.relative_to(ROOT)) for path, _ in items)
            errors.append(
                f"{collection}/{key}: expected exactly zh and en; "
                f"found {languages} in {locations}"
            )

    page_routes: dict[str, set[str]] = defaultdict(set)
    for collection, _, data in records:
        if collection == "_pages" and data.get("translation_key") in REQUIRED_ROUTES:
            page_routes[data["translation_key"]].add(data.get("permalink"))
    for key, expected in REQUIRED_ROUTES.items():
        if page_routes[key] != expected:
            errors.append(
                f"_pages/{key}: expected permalinks {sorted(expected)}, "
                f"found {sorted(str(route) for route in page_routes[key])}"
            )

    config_path = ROOT / "_config.yml"
    try:
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        errors.append(f"_config.yml: {error}")
        config = {}
    if config.get("theme") != "al_folio_core":
        errors.append("_config.yml: theme must remain al_folio_core")
    if config.get("url") != "https://functionhx.github.io":
        errors.append("_config.yml: canonical url must be https://functionhx.github.io")
    if config.get("baseurl") != "":
        errors.append("_config.yml: baseurl must be empty for the user Pages site")
    if config.get("enable_darkmode") is not True:
        errors.append("_config.yml: enable_darkmode must remain true")

    kaggle_path = ROOT / "_includes" / "kaggle-monitor.liquid"
    kaggle_text = kaggle_path.read_text(encoding="utf-8") if kaggle_path.exists() else ""
    if "https://functionhx.github.io/kaggle-agent/data/dashboard.json" not in kaggle_text:
        errors.append("_includes/kaggle-monitor.liquid: canonical dashboard endpoint missing")
    if "5 * 60 * 1000" not in kaggle_text:
        errors.append("_includes/kaggle-monitor.liquid: five-minute refresh contract missing")

    license_path = ROOT / "LICENSE"
    license_text = license_path.read_text(encoding="utf-8") if license_path.exists() else ""
    if "MIT License" not in license_text or "Maruan Al-Shedivat" not in license_text:
        errors.append("LICENSE: upstream al-folio MIT attribution must be retained")

    bibliography = (ROOT / "_bibliography" / "papers.bib").read_text(encoding="utf-8")
    if "PhysRev.47.777" not in bibliography:
        errors.append("_bibliography/papers.bib: original demo bibliography is missing")
    publication_pages = [
        data
        for collection, _, data in records
        if collection == "_pages" and data.get("translation_key") == "publications"
    ]
    if len(publication_pages) != 2 or not all(
        page.get("placeholder") and "al-folio" in str(page.get("source", "")).lower()
        for page in publication_pages
    ):
        errors.append(
            "_pages/publications: demo bibliography must be visibly governed by placeholder metadata"
        )

    if errors:
        print("Source validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"Source validation passed: {len(records)} bilingual records, "
        f"{len(groups)} translation pairs."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
