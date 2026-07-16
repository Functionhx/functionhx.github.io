#!/usr/bin/env python3
"""Utilities shared by translation and content validation scripts."""

from __future__ import annotations

import hashlib
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml


class ContentError(ValueError):
    """Raised when Markdown or front matter violates the content contract."""


class IndentedSafeDumper(yaml.SafeDumper):
    """Keep block lists indented beneath their keys for readable front matter."""

    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:
        return super().increase_indent(flow, False)


def represent_iso_datetime(dumper: yaml.SafeDumper, value: date | datetime) -> yaml.ScalarNode:
    return dumper.represent_scalar("tag:yaml.org,2002:timestamp", value.isoformat())


IndentedSafeDumper.add_representer(datetime, represent_iso_datetime)
IndentedSafeDumper.add_representer(date, represent_iso_datetime)


def repository_root() -> Path:
    return Path(__file__).resolve().parents[1]


def split_document(text: str, path: Path | None = None) -> tuple[dict[str, Any], str]:
    label = str(path) if path else "document"
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ContentError(f"{label} must start with YAML front matter")
    closing = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            closing = index
            break
    if closing is None:
        raise ContentError(f"{label} has unterminated YAML front matter")
    raw_front_matter = "".join(lines[1:closing])
    try:
        metadata = yaml.safe_load(raw_front_matter) or {}
    except yaml.YAMLError as error:
        raise ContentError(f"{label} contains invalid YAML: {error}") from error
    if not isinstance(metadata, dict):
        raise ContentError(f"{label} front matter must be a mapping")
    body = "".join(lines[closing + 1 :])
    return metadata, body


def render_document(metadata: dict[str, Any], body: str) -> str:
    front_matter = yaml.dump(
        metadata,
        Dumper=IndentedSafeDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=1000,
    ).rstrip()
    return f"---\n{front_matter}\n---\n{body.lstrip()}"


def source_hash(text: str) -> str:
    return hashlib.sha256(text.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text.rstrip() + "\n")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def markdown_files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*.md") if path.is_file())
