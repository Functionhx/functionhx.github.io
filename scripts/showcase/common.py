#!/usr/bin/env python3
"""Shared loaders and validation helpers for the public showcase dataset."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

import yaml


FILES = (
    "profile",
    "projects",
    "research",
    "achievements",
    "open_source",
    "links",
    "timeline",
)
LANGUAGES = ("zh-cn", "en")
STATUSES = {
    "completed",
    "active",
    "research",
    "manuscript-in-preparation",
    "patent-disclosure-in-preparation",
    "archived",
}
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class ValidationError(ValueError):
    """Raised when the public fact source violates its contract."""


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_showcase(root: Path | None = None) -> dict[str, Any]:
    root = root or repository_root()
    source_dir = root / "data" / "showcase"
    data: dict[str, Any] = {}
    for name in FILES:
        path = source_dir / f"{name}.yaml"
        if not path.is_file():
            raise ValidationError(f"missing showcase file: {path.relative_to(root)}")
        with path.open("r", encoding="utf-8") as handle:
            value = yaml.safe_load(handle)
        if not isinstance(value, dict):
            raise ValidationError(f"{path.relative_to(root)} must contain a mapping")
        data[name] = value
    return data


def require_mapping(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{path} must be a mapping")
    return value


def require_list(value: Any, path: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValidationError(f"{path} must be a list")
    return value


def require_text(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{path} must be a non-empty string")
    return value.strip()


def require_localized(value: Any, path: str) -> dict[str, str]:
    mapping = require_mapping(value, path)
    for language in LANGUAGES:
        require_text(mapping.get(language), f"{path}.{language}")
    return mapping


def require_id(value: Any, path: str) -> str:
    identifier = require_text(value, path)
    if not ID_PATTERN.fullmatch(identifier):
        raise ValidationError(f"{path} must use lowercase kebab-case")
    return identifier


def require_status(value: Any, path: str) -> str:
    status = require_text(value, path)
    if status not in STATUSES:
        allowed = ", ".join(sorted(STATUSES))
        raise ValidationError(f"{path} has invalid status {status!r}; expected one of: {allowed}")
    return status


def require_date(value: Any, path: str) -> str:
    if isinstance(value, date):
        return value.isoformat()
    text = require_text(value, path)
    try:
        date.fromisoformat(text)
    except ValueError as error:
        raise ValidationError(f"{path} must be an ISO date (YYYY-MM-DD)") from error
    return text


def require_page_path(value: Any, path: str) -> str:
    page = require_text(value, path)
    if not page.startswith("/") or not page.endswith("/") or "//" in page:
        raise ValidationError(f"{path} must be a root-relative path with a trailing slash")
    return page


def require_url(value: Any, path: str, *, allow_empty: bool = False) -> str:
    if allow_empty and (value is None or value == ""):
        return ""
    url = require_text(value, path)
    parsed = urlparse(url)
    if parsed.scheme == "mailto":
        if "@" not in parsed.path:
            raise ValidationError(f"{path} contains an invalid mailto URL")
        return url
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValidationError(f"{path} must be an absolute HTTP(S) or mailto URL")
    return url


def unique_ids(items: Iterable[dict[str, Any]], path: str) -> None:
    seen: set[str] = set()
    for index, item in enumerate(items):
        identifier = require_id(item.get("id"), f"{path}[{index}].id")
        if identifier in seen:
            raise ValidationError(f"duplicate id {identifier!r} in {path}")
        seen.add(identifier)


def validate_meta(document: dict[str, Any], path: str) -> None:
    meta = require_mapping(document.get("meta"), f"{path}.meta")
    if meta.get("schema_version") != 1:
        raise ValidationError(f"{path}.meta.schema_version must be 1")
    require_text(meta.get("status"), f"{path}.meta.status")
    require_text(meta.get("source"), f"{path}.meta.source")
    require_date(meta.get("last_verified"), f"{path}.meta.last_verified")


def validate_showcase(data: dict[str, Any]) -> None:
    for name in FILES:
        validate_meta(require_mapping(data.get(name), name), name)

    profile = data["profile"]
    require_localized(profile.get("name"), "profile.name")
    require_text(profile.get("display_name"), "profile.display_name")
    require_localized(profile.get("headline"), "profile.headline")
    require_localized(profile.get("tagline"), "profile.tagline")
    require_localized(profile.get("bio"), "profile.bio")
    education = require_mapping(profile.get("education"), "profile.education")
    for field in ("institution", "school", "program"):
        require_localized(education.get(field), f"profile.education.{field}")
    require_status(education.get("status"), "profile.education.status")
    focus = require_list(profile.get("focus"), "profile.focus")
    unique_ids(focus, "profile.focus")
    for index, item in enumerate(focus):
        item = require_mapping(item, f"profile.focus[{index}]")
        require_localized(item.get("title"), f"profile.focus[{index}].title")
        require_localized(item.get("summary"), f"profile.focus[{index}].summary")

    projects = data["projects"]
    featured = require_list(projects.get("featured"), "projects.featured")
    records = require_list(projects.get("records"), "projects.records")
    unique_ids(featured, "projects.featured")
    unique_ids(records, "projects.records")
    for index, item in enumerate(featured):
        item = require_mapping(item, f"projects.featured[{index}]")
        require_localized(item.get("title"), f"projects.featured[{index}].title")
        require_localized(item.get("summary"), f"projects.featured[{index}].summary")
        require_page_path(item.get("page"), f"projects.featured[{index}].page")
        require_status(item.get("status"), f"projects.featured[{index}].status")
        require_text(item.get("visual"), f"projects.featured[{index}].visual")
        technologies = require_list(item.get("technologies"), f"projects.featured[{index}].technologies")
        if not technologies:
            raise ValidationError(f"projects.featured[{index}].technologies cannot be empty")
        for tech_index, technology in enumerate(technologies):
            require_text(technology, f"projects.featured[{index}].technologies[{tech_index}]")
    for index, item in enumerate(records):
        item = require_mapping(item, f"projects.records[{index}]")
        require_localized(item.get("title"), f"projects.records[{index}].title")
        require_page_path(item.get("page"), f"projects.records[{index}].page")
        require_status(item.get("status"), f"projects.records[{index}].status")
        if not isinstance(item.get("featured"), bool):
            raise ValidationError(f"projects.records[{index}].featured must be boolean")

    research_records = require_list(data["research"].get("records"), "research.records")
    unique_ids(research_records, "research.records")
    for index, item in enumerate(research_records):
        item = require_mapping(item, f"research.records[{index}]")
        require_localized(item.get("title"), f"research.records[{index}].title")
        require_page_path(item.get("page"), f"research.records[{index}].page")
        require_status(item.get("status"), f"research.records[{index}].status")
        if not isinstance(item.get("confidential"), bool):
            raise ValidationError(f"research.records[{index}].confidential must be boolean")
        require_text(item.get("source"), f"research.records[{index}].source")

    achievements = require_list(data["achievements"].get("items"), "achievements.items")
    unique_ids(achievements, "achievements.items")
    for index, item in enumerate(achievements):
        item = require_mapping(item, f"achievements.items[{index}]")
        require_localized(item.get("title"), f"achievements.items[{index}].title")
        require_localized(item.get("detail"), f"achievements.items[{index}].detail")
        require_status(item.get("status"), f"achievements.items[{index}].status")
        require_text(item.get("source"), f"achievements.items[{index}].source")

    links = require_list(data["links"].get("items"), "links.items")
    unique_ids(links, "links.items")
    orders: set[int] = set()
    for index, item in enumerate(links):
        item = require_mapping(item, f"links.items[{index}]")
        require_text(item.get("label"), f"links.items[{index}].label")
        enabled = item.get("enabled")
        if not isinstance(enabled, bool):
            raise ValidationError(f"links.items[{index}].enabled must be boolean")
        require_url(item.get("url"), f"links.items[{index}].url", allow_empty=not enabled)
        order = item.get("order")
        if not isinstance(order, int) or order < 0 or order in orders:
            raise ValidationError(f"links.items[{index}].order must be a unique non-negative integer")
        orders.add(order)
        require_text(item.get("source"), f"links.items[{index}].source")

    open_source = data["open_source"]
    metrics = require_mapping(open_source.get("metrics"), "open_source.metrics")
    merged = require_mapping(metrics.get("merged_pull_requests"), "open_source.metrics.merged_pull_requests")
    if not isinstance(merged.get("value"), int) or merged["value"] < 0:
        raise ValidationError("open_source.metrics.merged_pull_requests.value must be a non-negative integer")
    require_localized(merged.get("label"), "open_source.metrics.merged_pull_requests.label")
    require_text(merged.get("source"), "open_source.metrics.merged_pull_requests.source")
    categories = require_list(open_source.get("categories"), "open_source.categories")
    unique_ids(categories, "open_source.categories")
    for index, item in enumerate(categories):
        require_localized(item.get("label"), f"open_source.categories[{index}].label")
    ecosystems = require_list(open_source.get("ecosystems"), "open_source.ecosystems")
    if not ecosystems:
        raise ValidationError("open_source.ecosystems cannot be empty")
    for index, item in enumerate(ecosystems):
        require_text(item.get("name"), f"open_source.ecosystems[{index}].name")

    timeline = require_list(data["timeline"].get("items"), "timeline.items")
    years: list[int] = []
    for index, item in enumerate(timeline):
        item = require_mapping(item, f"timeline.items[{index}]")
        year = item.get("year")
        if not isinstance(year, int) or year in years:
            raise ValidationError(f"timeline.items[{index}].year must be a unique integer")
        years.append(year)
        require_status(item.get("status"), f"timeline.items[{index}].status")
        require_localized(item.get("text"), f"timeline.items[{index}].text")
    if years != sorted(years):
        raise ValidationError("timeline.items must be sorted by year")


def validated_showcase(root: Path | None = None) -> dict[str, Any]:
    data = load_showcase(root)
    validate_showcase(data)
    return data


def public_showcase(data: dict[str, Any]) -> dict[str, Any]:
    exported = json.loads(json.dumps(data, default=str))
    exported["links"]["items"] = [item for item in exported["links"]["items"] if item["enabled"]]
    return exported


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def write_json(path: Path, value: Any) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2, default=str))
