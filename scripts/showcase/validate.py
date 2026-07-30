#!/usr/bin/env python3
"""Validate the public personal-hub fact source."""

from pathlib import Path
import sys
from urllib.parse import urlparse

import yaml


ROOT = Path(__file__).resolve().parents[2]
DATA_FILE = ROOT / "data" / "showcase" / "hub.yaml"
LANGUAGES = ("zh-cn", "en")


def require_bilingual(value: object, path: str, errors: list[str]) -> None:
    if not isinstance(value, dict):
        errors.append(f"{path}: expected a bilingual mapping")
        return
    for language in LANGUAGES:
        text = value.get(language)
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{path}.{language}: non-empty text is required")


def require_url(value: object, path: str, errors: list[str]) -> None:
    if not isinstance(value, str):
        errors.append(f"{path}: URL is required")
        return
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        errors.append(f"{path}: expected an absolute HTTPS URL")


def main() -> int:
    errors: list[str] = []
    if not DATA_FILE.exists():
        print(f"ERROR: missing {DATA_FILE.relative_to(ROOT)}", file=sys.stderr)
        return 1

    data = yaml.safe_load(DATA_FILE.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        print("ERROR: hub data must be a mapping", file=sys.stderr)
        return 1

    profile = data.get("profile", {})
    for field in (
        "name",
        "role",
        "headline",
        "summary",
        "current_focus",
        "status",
        "source",
    ):
        require_bilingual(profile.get(field), f"profile.{field}", errors)

    for collection in ("tools", "projects", "research", "knowledge_lanes"):
        items = data.get(collection)
        if not isinstance(items, list) or not items:
            errors.append(f"{collection}: at least one item is required")
            continue
        seen: set[str] = set()
        for index, item in enumerate(items):
            path = f"{collection}[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{path}: expected a mapping")
                continue
            item_id = item.get("id")
            if not isinstance(item_id, str) or not item_id:
                errors.append(f"{path}.id: non-empty id is required")
            elif item_id in seen:
                errors.append(f"{path}.id: duplicate id {item_id!r}")
            else:
                seen.add(item_id)
            require_bilingual(item.get("title"), f"{path}.title", errors)
            if collection in {"tools", "projects", "research", "knowledge_lanes"}:
                require_bilingual(
                    item.get("description")
                    if collection == "tools"
                    else item.get("summary"),
                    f"{path}.{'description' if collection == 'tools' else 'summary'}",
                    errors,
                )
            if collection == "tools":
                require_url(item.get("url"), f"{path}.url", errors)
                require_bilingual(item.get("status"), f"{path}.status", errors)
                require_bilingual(item.get("source"), f"{path}.source", errors)
            if collection in {"projects", "research"}:
                require_bilingual(item.get("status"), f"{path}.status", errors)
                require_bilingual(item.get("source"), f"{path}.source", errors)

    sources = data.get("publication_sources")
    if not isinstance(sources, list) or not sources:
        errors.append("publication_sources: at least one source is required")
    else:
        for index, source in enumerate(sources):
            if not isinstance(source, dict):
                errors.append(f"publication_sources[{index}]: expected a mapping")
                continue
            require_bilingual(
                source.get("label"), f"publication_sources[{index}].label", errors
            )
            require_bilingual(
                source.get("status"), f"publication_sources[{index}].status", errors
            )

    articles = data.get("external_articles")
    if not isinstance(articles, list):
        errors.append("external_articles: expected a list")
    else:
        article_ids: set[str] = set()
        for index, article in enumerate(articles):
            path = f"external_articles[{index}]"
            if not isinstance(article, dict):
                errors.append(f"{path}: expected a mapping")
                continue
            article_id = article.get("id")
            if not isinstance(article_id, str) or not article_id:
                errors.append(f"{path}.id: non-empty id is required")
            elif article_id in article_ids:
                errors.append(f"{path}.id: duplicate id {article_id!r}")
            else:
                article_ids.add(article_id)
            require_url(article.get("url"), f"{path}.url", errors)
            require_bilingual(article.get("title"), f"{path}.title", errors)
            require_bilingual(article.get("summary"), f"{path}.summary", errors)
            for field in ("date", "source", "status", "language"):
                value = article.get(field)
                if not isinstance(value, str) or not value.strip():
                    errors.append(f"{path}.{field}: non-empty text is required")

    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors), file=sys.stderr)
        return 1

    print(
        "Validated profile, tools, projects, research, knowledge lanes, "
        "publication sources, and external article registry."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
