#!/usr/bin/env python3
"""Validate bilingual Hugo content, translation metadata, statuses, and internal Markdown links."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from content_utils import ContentError, markdown_files, repository_root, source_hash, split_document


STATUSES = {
    "completed",
    "active",
    "research",
    "manuscript-in-preparation",
    "patent-disclosure-in-preparation",
    "archived",
}
LINK_PATTERN = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+['\"][^'\"]*['\"])?\)")
FENCE_PATTERN = re.compile(r"(?m)^\s*(`{3,}|~{3,})")


class ValidationFailure(ValueError):
    pass


def translation_value(metadata: dict[str, Any], key: str) -> Any:
    translation = metadata.get("translation")
    return translation.get(key) if isinstance(translation, dict) else None


def route_for(relative: Path) -> str:
    parts = list(relative.parts)
    filename = parts.pop()
    stem = filename[:-3]
    if stem == "_index":
        route_parts = parts
    elif stem == "index":
        route_parts = parts
    else:
        route_parts = [*parts, stem]
    return "/" + "/".join(route_parts).strip("/") + ("/" if route_parts else "")


def aliases(metadata: dict[str, Any]) -> list[str]:
    value = metadata.get("aliases") or []
    if not isinstance(value, list):
        raise ValidationFailure("aliases must be a list")
    return [str(alias) for alias in value]


def validate_front_matter(path: Path, metadata: dict[str, Any]) -> None:
    title = metadata.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValidationFailure(f"{path}: title must be a non-empty string")
    key = metadata.get("translationKey")
    if not isinstance(key, str) or not key.strip():
        raise ValidationFailure(f"{path}: translationKey must be a non-empty string")
    status = metadata.get("status")
    if status is not None and status not in STATUSES:
        raise ValidationFailure(f"{path}: unsupported status {status!r}")
    if "translation_locked" in metadata and not isinstance(metadata["translation_locked"], bool):
        raise ValidationFailure(f"{path}: translation_locked must be boolean")
    if "translate" in metadata and not isinstance(metadata["translate"], bool):
        raise ValidationFailure(f"{path}: translate must be boolean")


def validate_fences(path: Path, body: str) -> None:
    fences = FENCE_PATTERN.findall(body)
    backticks = sum(1 for fence in fences if fence.startswith("`"))
    tildes = len(fences) - backticks
    if backticks % 2 or tildes % 2:
        raise ValidationFailure(f"{path}: unbalanced fenced code block")


def main() -> int:
    root = repository_root()
    zh_root = root / "content" / "zh"
    en_root = root / "content" / "en"
    zh_files = markdown_files(zh_root)
    en_files = markdown_files(en_root)
    errors: list[str] = []
    routes: set[str] = {"/", "/en/"}
    parsed: dict[Path, tuple[dict[str, Any], str]] = {}

    for language_root, files, prefix in ((zh_root, zh_files, ""), (en_root, en_files, "/en")):
        for path in files:
            try:
                metadata, body = split_document(path.read_text(encoding="utf-8"), path)
                validate_front_matter(path.relative_to(root), metadata)
                validate_fences(path.relative_to(root), body)
                relative = path.relative_to(language_root)
                route = route_for(relative)
                routes.add((prefix + route) if route != "/" else (prefix + "/"))
                for alias in aliases(metadata):
                    normalized = alias if alias.startswith("/") else f"/{alias}"
                    routes.add((prefix + normalized) if prefix and not normalized.startswith("/en/") else normalized)
                parsed[path] = (metadata, body)
            except (ContentError, ValidationFailure) as error:
                errors.append(str(error))

    for source in zh_files:
        relative = source.relative_to(zh_root)
        source_metadata, _ = parsed.get(source, ({}, ""))
        if source_metadata.get("translate") is False:
            continue
        target = en_root / relative
        if not target.exists():
            errors.append(f"missing English translation: {target.relative_to(root)}")
            continue
        target_metadata, _ = parsed.get(target, ({}, ""))
        if source_metadata.get("translationKey") != target_metadata.get("translationKey"):
            errors.append(f"translationKey mismatch: {source.relative_to(root)} and {target.relative_to(root)}")
        expected_source = source.relative_to(root).as_posix()
        if translation_value(target_metadata, "source") != expected_source:
            errors.append(f"translation source mismatch: {target.relative_to(root)}")
        digest = source_hash(source.read_text(encoding="utf-8"))
        if translation_value(target_metadata, "source_hash") != digest:
            errors.append(f"stale translation hash: {target.relative_to(root)}")
        reviewed = translation_value(target_metadata, "reviewed")
        if not isinstance(reviewed, bool):
            errors.append(f"translation.reviewed must be boolean: {target.relative_to(root)}")

    for path, (_, body) in parsed.items():
        for raw_url in LINK_PATTERN.findall(body):
            url = raw_url.split("#", 1)[0]
            if not url or url.startswith(("http://", "https://", "mailto:", "#")):
                continue
            if url.startswith("/"):
                normalized = url if url.endswith("/") or Path(url).suffix else f"{url}/"
                if normalized not in routes and not normalized.startswith(("/images/", "/assets/", "/js/")):
                    errors.append(f"broken internal Markdown link in {path.relative_to(root)}: {raw_url}")

    if errors:
        for error in errors:
            print(f"content validation failed: {error}", file=sys.stderr)
        return 1
    print(f"content validation passed: {len(zh_files)} Chinese pages, {len(en_files)} English pages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
