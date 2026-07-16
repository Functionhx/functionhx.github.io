#!/usr/bin/env python3
"""Create reviewable English Hugo drafts with the DeepSeek Chat Completions API."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from content_utils import (
    ContentError,
    atomic_write,
    markdown_files,
    render_document,
    repository_root,
    source_hash,
    split_document,
)


DEFAULT_API_BASE = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-v4-pro"
TOKEN_PATTERN = re.compile(r"__PROTECTED_BLOCK_\d{4}__")


class TranslationError(RuntimeError):
    """Raised when a translation cannot be safely produced."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--file", type=Path, help="Translate one Chinese source file")
    mode.add_argument("--changed", action="store_true", help="Translate Chinese files changed from --base")
    mode.add_argument("--all-stale", action="store_true", help="Translate every stale or untranslated Chinese file")
    mode.add_argument(
        "--bootstrap-existing",
        action="store_true",
        help="Record current English drafts and hashes without calling the API (initial migration only)",
    )
    parser.add_argument("--base", help="Git base revision used by --changed")
    parser.add_argument("--force", action="store_true", help="Retranslate unchanged machine drafts; reviewed/locked files remain protected")
    parser.add_argument("--dry-run", action="store_true", help="List selected files without calling the API or writing files")
    return parser.parse_args()


def load_memory(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "files": {}}
    try:
        memory = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise TranslationError(f"invalid translation memory: {error}") from error
    if memory.get("version") != 1 or not isinstance(memory.get("files"), dict):
        raise TranslationError("translation memory must contain version 1 and a files mapping")
    return memory


def save_memory(path: Path, memory: dict[str, Any]) -> None:
    atomic_write(path, json.dumps(memory, ensure_ascii=False, indent=2, default=str))


def source_relative(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    source_root = (root / "content" / "zh").resolve()
    try:
        relative = resolved.relative_to(source_root)
    except ValueError as error:
        raise TranslationError(f"source must be under content/zh: {path}") from error
    if resolved.suffix.lower() != ".md" or not resolved.is_file():
        raise TranslationError(f"source must be an existing Markdown file: {path}")
    return relative


def target_for(source: Path, root: Path) -> Path:
    return root / "content" / "en" / source_relative(source, root)


def git_lines(root: Path, arguments: list[str]) -> list[str]:
    result = subprocess.run(
        ["git", *arguments],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise TranslationError(result.stderr.strip() or f"git {' '.join(arguments)} failed")
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def changed_sources(root: Path, base: str | None) -> list[Path]:
    base = base or os.environ.get("TRANSLATION_BASE_REF")
    if base and set(base) == {"0"}:
        return markdown_files(root / "content" / "zh")
    if not base:
        merge_base = subprocess.run(
            ["git", "merge-base", "origin/main", "HEAD"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
        base = merge_base.stdout.strip() if merge_base.returncode == 0 else "HEAD~1"
    names = git_lines(
        root,
        ["diff", "--name-only", "--diff-filter=ACMR", base, "--", "content/zh"],
    )
    names.extend(git_lines(root, ["ls-files", "--others", "--exclude-standard", "content/zh"] ))
    return sorted({root / name for name in names if name.endswith(".md")})


def selected_sources(args: argparse.Namespace, root: Path) -> list[Path]:
    if args.file:
        path = args.file if args.file.is_absolute() else root / args.file
        source_relative(path, root)
        return [path]
    if args.changed:
        return changed_sources(root, args.base)
    return markdown_files(root / "content" / "zh")


def should_skip_source(metadata: dict[str, Any]) -> str | None:
    if metadata.get("translate") is False:
        return "translate: false"
    if metadata.get("translation_locked") is True:
        return "source is translation_locked"
    return None


def target_protection(target: Path) -> str | None:
    if not target.exists():
        return None
    metadata, _ = split_document(target.read_text(encoding="utf-8"), target)
    if metadata.get("translation_locked") is True:
        return "target is translation_locked"
    translation = metadata.get("translation") or {}
    if isinstance(translation, dict) and translation.get("reviewed") is True:
        return "target translation is reviewed"
    return None


def protect_document(text: str) -> tuple[str, dict[str, str]]:
    protected: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        token = f"__PROTECTED_BLOCK_{len(protected):04d}__"
        protected[token] = match.group(0)
        return token

    patterns = (
        re.compile(r"(?ms)^(`{3,}|~{3,})[^\n]*\n.*?^\1[ \t]*$"),
        re.compile(r"`+[^`\n]+`+"),
        re.compile(r"<!--.*?-->", re.DOTALL),
        re.compile(r"<[^>\n]+>"),
        re.compile(r"https?://[^\s)\]}>\"']+"),
        re.compile(r"mailto:[^\s)\]}>\"']+"),
        re.compile(r"\$\$.*?\$\$", re.DOTALL),
        re.compile(r"(?<!\\)\$(?!\s).*?(?<!\\)\$"),
        re.compile(r"\\\(.*?\\\)|\\\[.*?\\\]", re.DOTALL),
    )
    masked = text
    for pattern in patterns:
        masked = pattern.sub(replace, masked)
    return masked, protected


def restore_document(text: str, protected: dict[str, str]) -> str:
    found = TOKEN_PATTERN.findall(text)
    expected = list(protected)
    if sorted(found) != sorted(expected) or len(found) != len(expected):
        raise TranslationError("translated output changed, removed, or duplicated protected tokens")
    for token, value in protected.items():
        text = text.replace(token, value)
    if TOKEN_PATTERN.search(text):
        raise TranslationError("translated output contains unresolved protected tokens")
    return text


def strip_wrapper(text: str) -> str:
    value = text.strip()
    fenced = re.fullmatch(r"```(?:markdown|md)?\s*\n(.*)\n```", value, re.DOTALL | re.IGNORECASE)
    if fenced:
        value = fenced.group(1).strip()
    if value.startswith("<document>") and value.endswith("</document>"):
        value = value[len("<document>") : -len("</document>")].strip()
    return value


def structure(value: Any, path: str = "", *, ignore_translation: bool = True) -> dict[str, str]:
    result: dict[str, str] = {}
    if isinstance(value, dict):
        result[path] = "mapping"
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            if ignore_translation and child_path == "translation":
                continue
            result.update(structure(child, child_path, ignore_translation=ignore_translation))
    elif isinstance(value, list):
        result[path] = f"list:{len(value)}"
        for index, child in enumerate(value):
            result.update(structure(child, f"{path}[{index}]", ignore_translation=ignore_translation))
    elif isinstance(value, bool):
        result[path] = "bool"
    elif isinstance(value, (int, float)):
        result[path] = "number"
    elif value is None:
        result[path] = "null"
    else:
        result[path] = "string"
    return result


def call_deepseek(masked_document: str, prompt: str, api_key: str, model: str, api_base: str) -> str:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"<document>\n{masked_document}\n</document>"},
        ],
        "temperature": 0.2,
        "stream": False,
    }
    request = Request(
        f"{api_base.rstrip('/')}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "functionhx-site-translator/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500].replace(api_key, "[redacted]")
        raise TranslationError(f"DeepSeek API returned HTTP {error.code}: {detail}") from error
    except (URLError, TimeoutError) as error:
        raise TranslationError(f"DeepSeek API request failed: {error}") from error
    try:
        data = json.loads(body)
        content = data["choices"][0]["message"]["content"]
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as error:
        raise TranslationError("DeepSeek API returned an unexpected response shape") from error
    if not isinstance(content, str) or not content.strip():
        raise TranslationError("DeepSeek API returned empty translated content")
    return content


def prepare_translation(
    source: Path,
    target: Path,
    prompt: str,
    api_key: str,
    model: str,
    api_base: str,
    root: Path,
) -> tuple[str, str, str]:
    source_text = source.read_text(encoding="utf-8")
    source_metadata, _ = split_document(source_text, source)
    masked, protected = protect_document(source_text)
    response = call_deepseek(masked, prompt, api_key, model, api_base)
    restored = restore_document(strip_wrapper(response), protected)
    target_metadata, target_body = split_document(restored, target)
    if structure(source_metadata) != structure(target_metadata):
        raise TranslationError(f"translated front matter structure changed for {source}")
    digest = source_hash(source_text)
    translated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    target_metadata["translation"] = {
        "source": source.relative_to(root).as_posix(),
        "source_hash": digest,
        "model": model,
        "translated_at": translated_at,
        "reviewed": False,
    }
    return render_document(target_metadata, target_body), digest, translated_at


def bootstrap_existing(sources: Iterable[Path], root: Path, memory_path: Path, memory: dict[str, Any]) -> int:
    count = 0
    for source in sources:
        relative = source.relative_to(root).as_posix()
        source_text = source.read_text(encoding="utf-8")
        source_metadata, _ = split_document(source_text, source)
        reason = should_skip_source(source_metadata)
        if reason:
            print(f"skip {relative}: {reason}")
            continue
        target = target_for(source, root)
        if not target.exists():
            print(f"skip {relative}: no existing English draft")
            continue
        target_text = target.read_text(encoding="utf-8")
        target_metadata, target_body = split_document(target_text, target)
        existing = target_metadata.get("translation")
        existing = existing if isinstance(existing, dict) else {}
        digest = source_hash(source_text)
        translated_at_value = existing.get("translated_at") or datetime.now(timezone.utc).replace(microsecond=0)
        translated_at = (
            translated_at_value.isoformat()
            if hasattr(translated_at_value, "isoformat")
            else str(translated_at_value)
        )
        model = existing.get("model") or "existing-content-bootstrap"
        reviewed = existing.get("reviewed") is True
        target_metadata["translation"] = {
            "source": relative,
            "source_hash": digest,
            "model": model,
            "translated_at": translated_at,
            "reviewed": reviewed,
        }
        atomic_write(target, render_document(target_metadata, target_body))
        memory["files"][relative] = {
            "target": target.relative_to(root).as_posix(),
            "source_hash": digest,
            "model": model,
            "translated_at": translated_at,
            "reviewed": reviewed,
        }
        count += 1
    save_memory(memory_path, memory)
    return count


def main() -> int:
    args = parse_args()
    root = repository_root()
    memory_path = root / "scripts" / "translation_memory.json"
    prompt_path = root / "scripts" / "translation_prompt.md"
    memory = load_memory(memory_path)
    sources = selected_sources(args, root)

    if args.bootstrap_existing:
        if args.dry_run:
            for source in sources:
                print(source.relative_to(root))
            return 0
        count = bootstrap_existing(sources, root, memory_path, memory)
        print(f"recorded {count} existing English drafts")
        return 0

    if not sources:
        print("no Chinese content files selected")
        return 0

    model = os.environ.get("DEEPSEEK_MODEL", DEFAULT_MODEL)
    api_base = os.environ.get("DEEPSEEK_API_BASE", DEFAULT_API_BASE)
    prompt = prompt_path.read_text(encoding="utf-8")
    candidates: list[tuple[Path, Path, str]] = []
    for source in sources:
        relative = source.relative_to(root).as_posix()
        metadata, _ = split_document(source.read_text(encoding="utf-8"), source)
        reason = should_skip_source(metadata)
        if reason:
            print(f"skip {relative}: {reason}")
            continue
        target = target_for(source, root)
        reason = target_protection(target)
        if reason:
            print(f"skip {relative}: {reason}")
            continue
        digest = source_hash(source.read_text(encoding="utf-8"))
        record = memory["files"].get(relative, {})
        if not args.force and target.exists() and record.get("source_hash") == digest:
            print(f"skip {relative}: source hash unchanged")
            continue
        candidates.append((source, target, digest))

    if args.dry_run:
        for source, target, digest in candidates:
            print(f"translate {source.relative_to(root)} -> {target.relative_to(root)} ({digest[:12]})")
        print(f"{len(candidates)} file(s) would be translated")
        return 0
    if not candidates:
        print("all selected translations are current or protected")
        return 0

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise TranslationError("DEEPSEEK_API_KEY is not set")

    completed = 0
    for source, target, _ in candidates:
        relative = source.relative_to(root).as_posix()
        print(f"translating {relative} with {model}")
        translated, digest, translated_at = prepare_translation(source, target, prompt, api_key, model, api_base, root)
        atomic_write(target, translated)
        memory["files"][relative] = {
            "target": target.relative_to(root).as_posix(),
            "source_hash": digest,
            "model": model,
            "translated_at": translated_at,
            "reviewed": False,
        }
        save_memory(memory_path, memory)
        completed += 1
    print(f"translated {completed} file(s); English drafts require review")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ContentError, OSError, TranslationError) as error:
        print(f"translation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
